import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize,
  Copy,
} from "lucide-react";
import { pdfViewers } from "./pdfCommands";
import "./pdf.css";

GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({
  data,
  path,
  group,
  onCommand,
}: {
  data: string;
  path: string;
  group: number;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [input, setInput] = useState("1");
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(600),
    [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);
  const scroll = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const text = useRef("");
  const actualScale = useRef(1);
  const command = (id: string, args = {}) =>
    onCommand(`pdf.${id}`, { ...args, group });
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError("");
    setRendered(false);
    const binary = atob(data),
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const assets = new URL("./pdf-assets/", document.baseURI).href;
    const task = getDocument({
      data: bytes,
      enableXfa: false,
      useWorkerFetch: false,
      cMapUrl: assets + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assets + "standard_fonts/",
      wasmUrl: assets + "wasm/",
      maxImageSize: 32 * 1024 * 1024,
    });
    task.promise
      .then((doc) => {
        if (!cancelled) {
          setPdf(doc);
          setPage((value) => Math.min(value, doc.numPages));
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason.name === "PasswordException"
              ? "Password-protected PDFs are not supported yet."
              : `Could not open PDF: ${reason.message}`,
          );
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setWidth(scroll.current?.clientWidth || 600),
    );
    observer.observe(scroll.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setInput(String(page));
  }, [page]);
  useEffect(() => {
    const element = scroll.current!;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      onCommand(event.deltaY < 0 ? "pdf.zoomIn" : "pdf.zoomOut", { group });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [group, onCommand]);
  useEffect(() => {
    pdfViewers.set(group, (action, args) => {
      if (action === "state")
        return {
          path,
          page,
          pages: pdf?.numPages || 0,
          zoom,
          rendered,
          error,
          text: text.current,
        };
      if (!pdf) throw new Error(error || "PDF is still loading");
      switch (action) {
        case "nextPage":
          setPage((value) => Math.min(pdf.numPages, value + 1));
          break;
        case "previousPage":
          setPage((value) => Math.max(1, value - 1));
          break;
        case "page": {
          const value = Number(args.page);
          if (!Number.isInteger(value) || value < 1 || value > pdf.numPages)
            throw new Error(`Choose a page from 1 to ${pdf.numPages}`);
          setPage(value);
          break;
        }
        case "zoomIn":
          setZoom((value) =>
            Math.min(3, (value === "fit" ? actualScale.current : value) + 0.25),
          );
          break;
        case "zoomOut":
          setZoom((value) =>
            Math.max(
              0.25,
              (value === "fit" ? actualScale.current : value) - 0.25,
            ),
          );
          break;
        case "fitWidth":
          setZoom("fit");
          break;
        case "actualSize":
          setZoom(1);
          break;
        case "copyPageText":
          if (!rendered) throw new Error("Wait for the page to render first");
          return navigator.clipboard.writeText(text.current);
      }
    });
    return () => {
      pdfViewers.delete(group);
    };
  }, [group, path, pdf, page, zoom, rendered, error]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false,
      render:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined;
    let layer: TextLayer | undefined;
    setRendered(false);
    setError("");
    text.current = "";
    surface.current!.replaceChildren();
    scroll.current!.scrollTop = 0;
    void (async () => {
      const item = await pdf.getPage(page);
      if (cancelled) return;
      const natural = item.getViewport({ scale: 1 });
      const scale =
        zoom === "fit"
          ? Math.min(3, Math.max(0.1, (width - 32) / natural.width))
          : zoom;
      actualScale.current = scale;
      const viewport = item.getViewport({ scale });
      if (viewport.width > 20000 || viewport.height > 20000)
        throw new Error("This PDF page is too large to display");
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        4096 / viewport.width,
        4096 / viewport.height,
      );
      const canvas = document.createElement("canvas"),
        container = document.createElement("div");
      container.className = "textLayer";
      const host = surface.current!;
      host.style.width = viewport.width + "px";
      host.style.height = viewport.height + "px";
      host.style.setProperty("--total-scale-factor", String(scale));
      host.style.setProperty("--scale-factor", String(scale));
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      host.replaceChildren(canvas, container);
      render = item.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      const content = await item.getTextContent();
      if (cancelled) return;
      text.current = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      layer = new TextLayer({
        textContentSource: content,
        container,
        viewport,
      });
      await layer.render();
      if (!cancelled) setRendered(true);
    })().catch((reason) => {
      if (!cancelled) setError(`Could not render page: ${reason.message}`);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, zoom, width]);
  return (
    <div className="pdf-viewer" data-pdf-group={group} data-rendered={rendered}>
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
        <button
          title="Previous page"
          aria-label="Previous PDF page"
          disabled={!pdf || page === 1}
          onClick={() => command("previousPage")}
        >
          <ChevronLeft size={14} />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            command("page", { page: Number(input) });
          }}
        >
          <input
            aria-label="PDF page number"
            inputMode="numeric"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={!pdf}
          />
          <span>/ {pdf?.numPages || "…"}</span>
        </form>
        <button
          title="Next page"
          aria-label="Next PDF page"
          disabled={!pdf || page === pdf.numPages}
          onClick={() => command("nextPage")}
        >
          <ChevronRight size={14} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom PDF out"
          disabled={!pdf}
          onClick={() => command("zoomOut")}
        >
          <Minus size={14} />
        </button>
        <button
          title="Actual size"
          disabled={!pdf}
          onClick={() => command("actualSize")}
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <button
          title="Zoom in"
          aria-label="Zoom PDF in"
          disabled={!pdf}
          onClick={() => command("zoomIn")}
        >
          <Plus size={14} />
        </button>
        <button
          title="Fit to width"
          aria-label="Fit PDF to width"
          disabled={!pdf}
          onClick={() => command("fitWidth")}
        >
          <Maximize size={14} />
        </button>
        <button
          title="Copy page text"
          aria-label="Copy PDF page text"
          disabled={!rendered}
          onClick={() => command("copyPageText")}
        >
          <Copy size={14} />
        </button>
      </div>
      {error && (
        <div className="pdf-error" role="alert">
          {error}
        </div>
      )}
      {!pdf && !error && <div className="loading">Preparing PDF…</div>}
      <div
        className="pdf-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="PDF page"
        onKeyDown={(event) => {
          const action =
            event.key === "PageDown"
              ? "nextPage"
              : event.key === "PageUp"
                ? "previousPage"
                : event.ctrlKey || event.metaKey
                  ? ["+", "="].includes(event.key)
                    ? "zoomIn"
                    : event.key === "-"
                      ? "zoomOut"
                      : event.key === "0"
                        ? "actualSize"
                        : undefined
                  : undefined;
          if (action) {
            event.preventDefault();
            event.stopPropagation();
            command(action);
          }
        }}
      >
        <div className="pdf-page" ref={surface} aria-label={`Page ${page}`} />
      </div>
    </div>
  );
}
