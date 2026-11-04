import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { basename, dirname, resolvePath, type RemoteFile } from "./types";

const policy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const raster = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

// Produce a self-contained static document. The opaque sandbox never receives
// the preload API, scripts, network access, popups, forms or top navigation.
export async function prepareHtml(
  text: string,
  path: string,
  root: string,
  cancelled: () => boolean,
) {
  const warnings = new Set<string>();
  let requests = 0,
    bytes = 0;
  const cache = new Map<string, Promise<string>>();
  function assetPath(reference: string, base: string) {
    if (cancelled()) throw new Error("Preview cancelled");
    const value = reference.trim();
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value))
      throw new Error("External resources are not loaded");
    const decoded = decodeURIComponent(value.split(/[?#]/)[0]);
    if (!decoded) throw new Error("Empty resource path");
    const file = resolvePath(
      decoded.startsWith("/") ? root : dirname(base),
      decoded.startsWith("/") ? decoded.slice(1) : decoded,
    );
    const workspace = root.replaceAll("\\", "/").replace(/\/$/, "");
    const windows = /^[a-z]:/i.test(root);
    const a = windows ? file.toLowerCase() : file,
      b = windows ? workspace.toLowerCase() : workspace;
    if (a !== b && !a.startsWith(b + "/"))
      throw new Error("Resource is outside the workspace");
    return file;
  }
  function read(file: string, kind: "css" | "image"): Promise<string> {
    const key = kind + file;
    if (cache.has(key)) return cache.get(key)!;
    if (++requests > 64)
      return Promise.reject(new Error("Preview resource limit reached (64)"));
    const pending = (async () => {
      if (cancelled()) throw new Error("Preview cancelled");
      let value: string;
      if (kind === "css") {
        if (!/\.css$/i.test(file))
          throw new Error("Only CSS stylesheets are loaded");
        value = (await window.lwr.remote<RemoteFile>("read", { path: file }))
          .text;
      } else if (/\.svg$/i.test(file)) {
        const svg = (
          await window.lwr.remote<RemoteFile>("read", { path: file })
        ).text;
        value =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(
            DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
            }),
          );
      } else {
        if (!raster.test(file))
          throw new Error("Resource type is not supported in static previews");
        value = (
          await window.lwr.remote<{ url: string }>("image", { path: file })
        ).url;
      }
      bytes += value.length;
      if (bytes > 24 * 1024 * 1024)
        throw new Error("Preview resource limit reached (24 MiB)");
      return value;
    })();
    cache.set(key, pending);
    return pending;
  }
  async function image(reference: string, base: string) {
    if (
      /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(
        reference,
      )
    )
      return reference;
    try {
      return await read(assetPath(reference, base), "image");
    } catch (error) {
      warnings.add(String(error).replace(/^Error: /, ""));
      return "";
    }
  }
  async function replaceAsync(
    value: string,
    pattern: RegExp,
    replace: (match: RegExpMatchArray) => Promise<string>,
  ) {
    let result = "",
      position = 0;
    for (const match of value.matchAll(pattern)) {
      if (cancelled()) throw new Error("Preview cancelled");
      result += value.slice(position, match.index) + (await replace(match));
      position = match.index! + match[0].length;
    }
    return result + value.slice(position);
  }
  async function css(
    value: string,
    base: string,
    parents = new Set<string>(),
  ): Promise<string> {
    // Imports are resolved relative to each stylesheet, with cycle/depth bounds.
    value = await replaceAsync(
      value,
      /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?\s*([^;]*);/gi,
      async (m) => {
        try {
          const file = assetPath(m[1] || m[2] || m[3], base);
          if (parents.has(file) || parents.size >= 4)
            throw new Error("Stylesheet import cycle or depth limit");
          const imported = await css(
            await read(file, "css"),
            file,
            new Set([...parents, file]),
          );
          return m[4].trim() ? `@media ${m[4]} {${imported}}` : imported;
        } catch (error) {
          warnings.add(String(error).replace(/^Error: /, ""));
          return "";
        }
      },
    );
    return replaceAsync(
      value,
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
      async (m) => {
        const reference = (m[1] ?? m[2] ?? m[3]).trim();
        if (reference.startsWith("#")) return m[0];
        return `url("${(await image(reference, base)).replaceAll('"', "%22")}")`;
      },
    );
  }
  const clean = DOMPurify.sanitize(text, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["link"],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "base",
      "meta",
      "audio",
      "video",
      "source",
    ],
    FORBID_ATTR: [
      "srcset",
      "ping",
      "action",
      "formaction",
      "srcdoc",
      "autofocus",
    ],
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  const imports = [...doc.querySelectorAll("link")];
  for (const link of imports) {
    if (link.getAttribute("rel")?.toLowerCase() === "stylesheet") {
      try {
        const file = assetPath(link.getAttribute("href") || "", path);
        const style = doc.createElement("style");
        style.textContent = await css(
          await read(file, "css"),
          file,
          new Set([file]),
        );
        if (link.getAttribute("media"))
          style.setAttribute("media", link.getAttribute("media")!);
        link.replaceWith(style);
      } catch (error) {
        warnings.add(String(error).replace(/^Error: /, ""));
        link.remove();
      }
    } else link.remove();
  }
  for (const style of doc.querySelectorAll("style"))
    style.textContent = await css(style.textContent || "", path);
  for (const element of doc.querySelectorAll("[style]"))
    element.setAttribute(
      "style",
      await css(element.getAttribute("style")!, path),
    );
  for (const img of doc.querySelectorAll("img")) {
    const url = await image(img.getAttribute("src") || "", path);
    if (url) img.setAttribute("src", url);
    else img.removeAttribute("src");
  }
  // Anchors remain useful; navigation, SVG external references and fetch-capable
  // attributes cannot escape this self-contained preview.
  for (const element of doc.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        /^(?:href|xlink:href)$/i.test(attribute.name) &&
        !attribute.value.startsWith("#")
      )
        element.removeAttribute(attribute.name);
      if (attribute.name === "src" && element.tagName !== "IMG")
        element.removeAttribute("src");
    }
  }
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = policy;
  doc.head.prepend(csp);
  return {
    html: "<!doctype html>" + doc.documentElement.outerHTML,
    warnings: [...warnings],
  };
}

export default function HtmlPreview({
  text,
  path,
  root,
  refresh,
}: {
  text: string;
  path: string;
  root: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{ html: string; warnings: string[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    setError("");
    const timer = setTimeout(() => {
      void prepareHtml(text, path, root, () => cancelled)
        .then((value) => {
          if (!cancelled) setResult(value);
        })
        .catch((error) => {
          if (!cancelled) setError(String(error));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, path, root, refresh]);
  return (
    <div className="html-preview">
      <div className="html-preview-note">
        Static HTML · scripts and external resources disabled
        {result?.warnings.length
          ? ` · ${result.warnings.length} resource warning${result.warnings.length === 1 ? "" : "s"}`
          : ""}
        {result?.warnings.length ? (
          <span title={result.warnings.join("\n")}> ⓘ</span>
        ) : null}
      </div>
      {error ? (
        <div className="file-load-state" role="alert">
          {error}
        </div>
      ) : !result ? (
        <div className="file-load-state" role="status">
          Preparing HTML preview…
        </div>
      ) : (
        <iframe
          title={`HTML preview: ${basename(path)}`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={result.html}
        />
      )}
    </div>
  );
}
