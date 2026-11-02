import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import Mark from "mark.js";
import type { PreviewFindRequest } from "./previewFindCommands";

const LIMIT = 1000;
export default function PreviewFind({
  container,
  viewport,
  revision,
  path,
  group,
  onCommand,
}: {
  container: RefObject<HTMLElement | null>;
  viewport: RefObject<HTMLElement | null>;
  revision: string;
  path: string;
  group: number;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState(0);
  const [count, setCount] = useState(0);
  const [limited, setLimited] = useState(false);
  const [focus, setFocus] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useRef<HTMLElement[][]>([]);
  const active = useRef(-1);
  const snapshot = useRef({
    open,
    search,
    matches: count,
    current: position,
    limited,
  });
  snapshot.current = {
    open,
    search,
    matches: count,
    current: position,
    limited,
  };

  function select(index: number) {
    const all = matches.current;
    all[active.current]?.forEach((element) =>
      element.classList.remove("current-match"),
    );
    active.current = all.length ? (index + all.length) % all.length : -1;
    const selected = all[active.current];
    selected?.forEach((element) => element.classList.add("current-match"));
    // Scroll only this preview; scrollIntoView can move containing editor panes.
    const article = viewport.current;
    if (selected && article) {
      const bounds = article.getBoundingClientRect();
      const target = selected[0].getBoundingClientRect();
      if (target.top < bounds.top || target.bottom > bounds.bottom)
        article.scrollTop += target.top - bounds.top - article.clientHeight / 2;
      if (target.left < bounds.left || target.right > bounds.right)
        selected[0].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    setPosition(active.current + 1);
  }

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<PreviewFindRequest>).detail;
      if (detail.group !== group) return;
      detail.handled = true;
      if (detail.action === "findState") detail.result = snapshot.current;
      else if (detail.action === "find") {
        setOpen(true);
        if (detail.search !== undefined) setSearch(detail.search);
        setFocus((value) => value + 1);
      } else if (detail.action === "closeFind") {
        setOpen(false);
        container.current?.focus({ preventScroll: true });
      } else if (!snapshot.current.open) {
        setOpen(true);
        setFocus((value) => value + 1);
      } else select(active.current + (detail.action === "findNext" ? 1 : -1));
    };
    window.addEventListener("owlet-preview-find", handle);
    return () => window.removeEventListener("owlet-preview-find", handle);
  }, [group, container, viewport]);

  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open, focus]);
  useEffect(() => {
    setOpen(false);
    setSearch("");
  }, [path]);
  useEffect(() => {
    const article = container.current;
    if (!article) return;
    // Preview owns this HTML subtree; mark.js never touches React-owned controls.
    const marker = new Mark(article);
    matches.current = [];
    active.current = -1;
    setCount(0);
    setPosition(0);
    setLimited(false);
    marker.unmark({ className: "preview-match" });
    if (!open || !search.trim()) return;
    const timer = window.setTimeout(() => {
      let remaining = 0;
      let capped = false;
      const found: HTMLElement[][] = [];
      // Literal regex makes metacharacters ordinary text, and lets fragments of a
      // match spanning <strong>/<code> be counted and navigated as one result.
      const literal = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      marker.markRegExp(new RegExp(literal, "gi"), {
        className: "preview-match",
        acrossElements: true,
        exclude: [
          ".katex",
          ".katex *",
          ".diagram",
          ".diagram *",
          "svg",
          "svg *",
          "math",
          "math *",
          "button",
          ".image-error",
        ],
        filter: () => {
          if (found.length < LIMIT || remaining > 0) return true;
          capped = true;
          return false;
        },
        each: (element) => {
          if (!remaining) {
            found.push([]);
            remaining = search.length;
          }
          found[found.length - 1].push(element as HTMLElement);
          remaining -= element.textContent?.length || 0;
        },
        done: () => {
          matches.current = found;
          setCount(found.length);
          setLimited(capped);
          select(0);
        },
      });
    }, 80);
    return () => {
      clearTimeout(timer);
      marker.unmark({ className: "preview-match" });
    };
  }, [open, search, revision, path, container]);

  if (!open) return null;
  return (
    <div
      className="preview-find"
      role="search"
      aria-label="Find in preview"
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onCommand(
            event.key === "Escape"
              ? "preview.closeFind"
              : event.shiftKey
                ? "preview.findPrevious"
                : "preview.findNext",
          );
        }
      }}
    >
      <input
        ref={input}
        aria-label="Find in preview"
        placeholder="Find in preview"
        value={search}
        maxLength={512}
        title="Text search · equations and diagrams excluded"
        onChange={(event) => setSearch(event.target.value)}
      />
      <span className="preview-find-count" role="status" aria-live="polite">
        {search
          ? count
            ? `${position}/${count}${limited ? "+" : ""}`
            : "No matches"
          : ""}
      </span>
      <button
        title="Previous match (Shift+Enter)"
        aria-label="Previous preview match"
        disabled={!count}
        onClick={() => onCommand("preview.findPrevious")}
      >
        <ArrowUp size={14} />
      </button>
      <button
        title="Next match (Enter)"
        aria-label="Next preview match"
        disabled={!count}
        onClick={() => onCommand("preview.findNext")}
      >
        <ArrowDown size={14} />
      </button>
      <button
        title="Close find (Esc)"
        aria-label="Close preview find"
        onClick={() => onCommand("preview.closeFind")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
