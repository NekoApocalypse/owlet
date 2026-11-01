import { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
import katex from "katex";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import "katex/dist/katex.min.css";
import "highlight.js/styles/tomorrow-night-blue.css";
import { dirname, resolvePath } from "./types";

for (const [name, language] of Object.entries({
  javascript,
  typescript,
  python,
  json,
  xml,
  css,
  bash,
  yaml,
  markdown,
}))
  hljs.registerLanguage(name, language);
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight: (code, language) => {
    if (language && hljs.getLanguage(language))
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return "";
  },
});
function math(source: string, displayMode = false) {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    maxExpand: 1000,
    maxSize: 20,
  });
}
// Parse before Markdown's escape rule, while backticks/fences retain their own literal content.
md.inline.ruler.before("escape", "lwr_math", (state, silent) => {
  const at = state.pos;
  const source = state.src;
  const opener = source.startsWith("\\(", at)
    ? "\\("
    : source.startsWith("\\[", at)
      ? "\\["
      : source.startsWith("$$", at)
        ? "$$"
        : source[at] === "$"
          ? "$"
          : "";
  if (!opener) return false;
  const closer = opener === "\\(" ? "\\)" : opener === "\\[" ? "\\]" : opener;
  const start = at + opener.length;
  if (
    opener === "$" &&
    (/\s/.test(source[start] || "") || /\d/.test(source[at - 1] || ""))
  )
    return false;
  let end = source.indexOf(closer, start);
  while (end >= 0 && source[end - 1] === "\\")
    end = source.indexOf(closer, end + closer.length);
  if (end < 0 || end === start) return false;
  if (
    opener === "$" &&
    (/\s/.test(source[end - 1]) || /\d/.test(source[end + 1] || ""))
  )
    return false;
  if (!silent) {
    const token = state.push("lwr_math", "", 0);
    token.content = source.slice(start, end);
    token.meta = { display: opener === "$$" || opener === "\\[" };
  }
  state.pos = end + closer.length;
  return true;
});
md.renderer.rules.lwr_math = (tokens, index) =>
  math(tokens[index].content, Boolean(tokens[index].meta?.display));
md.block.ruler.before(
  "fence",
  "lwr_math_block",
  (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    const opener = line.startsWith("$$")
      ? "$$"
      : line.startsWith("\\[")
        ? "\\["
        : "";
    if (!opener) return false;
    const closer = opener === "$$" ? "$$" : "\\]";
    let content = line.slice(opener.length),
      next = startLine;
    let closing = content.indexOf(closer);
    while (closing < 0 && next + 1 < endLine) {
      next++;
      content +=
        "\n" +
        state.src.slice(
          state.bMarks[next] + state.tShift[next],
          state.eMarks[next],
        );
      closing = content.indexOf(closer);
    }
    if (closing < 0 || content.slice(closing + closer.length).trim())
      return false;
    if (silent) return true;
    const token = state.push("lwr_math_block", "div", 0);
    token.content = content.slice(0, closing);
    token.map = [startLine, next + 1];
    state.line = next + 1;
    return true;
  },
  { alt: ["paragraph", "reference", "blockquote", "list"] },
);
md.renderer.rules.lwr_math_block = (tokens, index) =>
  math(tokens[index].content, true);
const fence = md.renderer.rules.fence!;
function encodeDiagram(source: string) {
  if (source.length > 50000)
    return btoa("Diagram exceeds the 50,000 character limit");
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
md.renderer.rules.fence = (tokens, index, options, env, self) =>
  tokens[index].info.trim().toLowerCase() === "mermaid"
    ? `<div class="diagram" data-mermaid="${encodeDiagram(tokens[index].content)}"><span class="render-pending">Rendering diagram…</span></div>`
    : fence(tokens, index, options, env, self);
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const source = String(token.attrGet("src") || "");
  const alt = token.content || "Image";
  return `<span class="remote-image" data-source="${md.utils.escapeHtml(source)}"><img alt="${md.utils.escapeHtml(alt)}" /><span class="image-caption">${md.utils.escapeHtml(alt)}</span></span>`;
};
md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const title = tokens[index + 1]?.content || "";
  tokens[index].attrSet(
    "id",
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-"),
  );
  return self.renderToken(tokens, index, options);
};
let diagramCounter = 0;
export default function Preview({
  text,
  path,
  root,
  onOpen,
  onCommand,
  refresh = 0,
}: {
  text: string;
  path: string;
  root: string;
  onOpen(path: string): void;
  onCommand(id: string, args?: Record<string, unknown>): void;
  refresh?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () =>
      DOMPurify.sanitize(md.render(text), {
        ADD_ATTR: ["data-mermaid", "data-source"],
        FORBID_TAGS: ["style", "iframe", "object", "script"],
      }),
    [text],
  );
  useEffect(() => {
    let cancelled = false;
    const element = container.current!;
    for (const image of element.querySelectorAll<HTMLElement>(
      ".remote-image",
    )) {
      const source = image.dataset.source || "";
      window.lwr
        .remote<{ url: string; path: string }>("image", {
          source,
          document: path,
          root,
        })
        .then((result) => {
          if (cancelled) return;
          image.querySelector("img")!.src = result.url;
          image.title = result.path;
        })
        .catch((error) => {
          if (!cancelled) {
            image.classList.add("image-error");
            image.querySelector(".image-caption")!.textContent =
              `${source}: ${String(error).replace(/^Error: /, "")}`;
          }
        });
    }
    const diagrams = [
      ...element.querySelectorAll<HTMLElement>("[data-mermaid]"),
    ];
    if (diagrams.length)
      void import("mermaid").then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          htmlLabels: false,
          secure: [
            ...(mermaid.mermaidAPI.defaultConfig.secure || []),
            "htmlLabels",
          ],
          suppressErrorRendering: true,
          maxTextSize: 50000,
          maxEdges: 500,
          themeVariables: {
            primaryColor: "#001c40",
            primaryBorderColor: "#bbdaff",
            primaryTextColor: "#ffffff",
            lineColor: "#bbdaff",
            fontFamily: "Segoe UI, sans-serif",
          },
        });
        for (const diagram of diagrams) {
          if (cancelled) return;
          try {
            const source = new TextDecoder().decode(
              Uint8Array.from(atob(diagram.dataset.mermaid || ""), (c) =>
                c.charCodeAt(0),
              ),
            );
            const { svg } = await mermaid.render(
              `lwr-diagram-${++diagramCounter}`,
              source,
            );
            if (!cancelled)
              diagram.innerHTML = DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              });
          } catch (error) {
            if (!cancelled) {
              diagram.textContent = `Diagram error: ${String(error)}`;
              diagram.classList.add("diagram-error");
            }
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [html, path, root, refresh]);
  return (
    <article
      className="markdown-preview"
      ref={container}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute("href") || "";
        if (href.startsWith("#")) {
          onCommand("markdown.heading", {
            id: decodeURIComponent(href.slice(1)),
          });
          return;
        }
        if (/^https?:/i.test(href)) {
          onCommand("link.openExternal", { url: href });
          return;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href))
          return;
        try {
          onOpen(
            resolvePath(dirname(path), decodeURIComponent(href.split("#")[0])),
          );
        } catch {}
      }}
    />
  );
}
