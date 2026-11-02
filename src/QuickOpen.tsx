import { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { FileIcon } from "./Explorer";
import { basename, type Entry } from "./types";

export type FileIndex = {
  root: string;
  files: string[];
  loading: boolean;
  limited: boolean;
  errors: number;
  scanned: number;
  completedAt: number;
};
const excluded = new Set([".git", "node_modules", ".venv", "__pycache__"]);
export function useFileIndex(
  root: string,
  connected: boolean,
  depth: number,
  revision: number,
  busy: boolean,
) {
  const [index, setIndex] = useState<FileIndex>({
    root,
    files: [],
    loading: false,
    limited: false,
    errors: 0,
    scanned: 0,
    completedAt: 0,
  });
  const current = useRef(index),
    previousDepth = useRef(depth);
  current.current = index;
  const priority = useRef(busy);
  priority.current = busy;
  useEffect(() => {
    let cancelled = false;
    const previousFiles =
      current.current.root === root && previousDepth.current === depth
        ? current.current.files
        : [];
    previousDepth.current = depth;
    const next: FileIndex = {
      root,
      files: previousFiles,
      loading: !!root && connected,
      limited: false,
      errors: 0,
      scanned: 0,
      completedAt: 0,
    };
    setIndex(next);
    if (!root || !connected) return;
    const queue = [{ path: root, level: 0, offset: 0 }];
    const found = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    async function step() {
      if (cancelled) return;
      // A single bounded page in flight, yielding between pages. File opens/saves
      // and connection startup never wait for the full tree.
      if (priority.current) {
        timer = setTimeout(step, 100);
        return;
      }
      const item = queue.shift();
      if (!item) {
        setIndex({
          ...next,
          files: [...found],
          loading: false,
          completedAt: Date.now(),
        });
        return;
      }
      try {
        const page = await window.lwr.remote<{
          entries: Entry[];
          next: number | null;
        }>("list", { path: item.path, offset: item.offset });
        if (cancelled) return;
        next.scanned++;
        for (const entry of page.entries) {
          if (/^\.owlet-(upload|download|save|copy)-/.test(entry.name))
            continue;
          if (entry.directory) {
            if (
              item.level < depth &&
              !entry.symlink &&
              !excluded.has(entry.name)
            ) {
              if (queue.length < 5000)
                queue.push({
                  path: entry.path,
                  level: item.level + 1,
                  offset: 0,
                });
              else next.limited = true;
            }
          } else if (found.size < 20000) found.add(entry.path);
          else next.limited = true;
        }
        if (page.next !== null) queue.push({ ...item, offset: page.next });
        if (found.size >= 20000 || next.scanned >= 10000) {
          next.limited = true;
          queue.length = 0;
        }
      } catch {
        if (!cancelled) next.errors++;
      }
      if (cancelled) return;
      setIndex({
        ...next,
        files: queue.length
          ? [...new Set([...found, ...previousFiles])].slice(0, 20000)
          : [...found],
        loading: queue.length > 0,
        completedAt: queue.length ? 0 : Date.now(),
      });
      if (queue.length) timer = setTimeout(step, 50);
    }
    // Explorer and initial file/terminal requests get the first turn.
    timer = setTimeout(step, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [root, connected, depth, revision]);
  return index.root === root
    ? index
    : {
        root,
        files: [],
        loading: true,
        limited: false,
        errors: 0,
        scanned: 0,
        completedAt: 0,
      };
}

function fuzzyScore(text: string, query: string) {
  let cursor = 0,
    previous = -2,
    score = 0;
  const lower = text.toLowerCase();
  for (const char of query.toLowerCase().replace(/\s/g, "")) {
    const position = lower.indexOf(char, cursor);
    if (position < 0) return -Infinity;
    score += position === previous + 1 ? 12 : 1;
    if (
      position === 0 ||
      /[\/_.\-\s]/.test(text[position - 1]) ||
      (/[A-Z]/.test(text[position]) && /[a-z]/.test(text[position - 1]))
    )
      score += 8;
    previous = position;
    cursor = position + 1;
  }
  return score - text.length * 0.02;
}
export function searchFiles(index: FileIndex, query: string, limit = 100) {
  if (typeof query !== "string" || query.length > 256)
    throw new Error("File query must be at most 256 characters.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Result limit must be between 1 and 200.");
  const needle = query.trim().replaceAll("\\", "/");
  return index.files
    .map((path) => {
      const relative = path.slice(index.root.replace(/\/$/, "").length + 1);
      const name = basename(path);
      const score = needle
        ? Math.max(fuzzyScore(relative, needle), fuzzyScore(name, needle) + 30)
        : 0;
      return { path, relative, name, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative))
    .slice(0, limit);
}
export default function QuickOpen({
  index,
  initialQuery,
  onCommand,
  onClose,
}: {
  index: FileIndex;
  initialQuery: string;
  onCommand(id: string, args?: Record<string, unknown>): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [selected, setSelected] = useState(0);
  const results = useMemo(() => searchFiles(index, query), [index, query]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, results.length - 1)));
  }, [results.length]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const open = (path: string) => {
    onClose();
    onCommand("file.open", { path });
  };
  return (
    <div
      className="palette-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette quick-open"
        role="dialog"
        aria-label="Quick Open"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((value) =>
              Math.max(
                0,
                Math.min(
                  results.length - 1,
                  value + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (results[selected]) open(results[selected].path);
          }
        }}
      >
        <div className="palette-search">
          <Search size={17} />
          <input
            autoFocus
            aria-label="Search files"
            placeholder="Search files by name or path…"
            maxLength={256}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            title="Refresh file index"
            aria-label="Refresh file index"
            onClick={() => onCommand("file.index.refresh")}
          >
            <RefreshCw size={14} />
          </button>
          <kbd>ESC</kbd>
        </div>
        <div
          className="command-list"
          role="listbox"
          aria-label="Matching files"
          ref={list}
        >
          {results.map((item, i) => (
            <button
              key={item.path}
              role="option"
              aria-selected={i === selected}
              className={`command-option ${i === selected ? "highlighted" : ""}`}
              onMouseMove={() => setSelected(i)}
              onClick={() => open(item.path)}
            >
              <span>
                <FileIcon path={item.path} />
                {item.name}
              </span>
              <small title={item.relative}>{item.relative}</small>
            </button>
          ))}
          {!results.length && (
            <div className="no-commands">
              {index.loading
                ? "Searching available files…"
                : "No matching files"}
            </div>
          )}
        </div>
        <div className="palette-footer">
          <span>↑ ↓ navigate · Enter open</span>
          <span role="status">
            {index.loading
              ? "Indexing… "
              : index.limited || index.errors
                ? "Partial index… "
                : ""}
            {index.files.length.toLocaleString()} files
            {index.errors ? ` · ${index.errors} folders unavailable` : ""}
            {index.limited ? " · scan limit reached" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
