import { useEffect, useRef, useState } from "react";
import { FolderOpen, Wifi, X } from "lucide-react";
import { basename, type RecentWorkspace } from "./types";

export default function RecentWorkspaces({
  entries,
  removing,
  onOpen,
  onRemove,
  onClose,
}: {
  entries: RecentWorkspace[];
  removing: boolean;
  onOpen(id: string): void;
  onRemove(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const results = entries.filter((entry) =>
    `${entry.path} ${entry.target || "Local"}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  useEffect(() => setSelected(0), [query, entries]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const choose = (id: string) => (removing ? onRemove(id) : onOpen(id));
  return (
    <div
      className="palette-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette recent-picker"
        role="dialog"
        aria-modal="true"
        aria-label={
          removing ? "Remove Recent Workspace" : "Recently Opened Windows"
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (results[selected]) choose(results[selected].id);
          }
        }}
      >
        <div className="palette-search">
          <FolderOpen size={17} />
          <input
            autoFocus
            aria-label="Search recent workspaces"
            placeholder="Search folders or SSH hosts…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button aria-label="Close recent workspaces" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div
          className="command-list"
          role="listbox"
          aria-label="Recent workspaces"
          ref={list}
        >
          {results.map((entry, index) => (
            <button
              key={entry.id}
              role="option"
              aria-selected={selected === index}
              className={`command-option recent-option ${selected === index ? "highlighted" : ""}`}
              title={entry.path}
              onMouseMove={() => setSelected(index)}
              onClick={() => choose(entry.id)}
            >
              {entry.kind === "ssh" ? (
                <Wifi size={15} />
              ) : (
                <FolderOpen size={15} />
              )}
              <span className="recent-description">
                <strong>{basename(entry.path)}</strong>
                <small>{entry.path}</small>
              </span>
              <span className="recent-host">
                {entry.kind === "ssh" ? `SSH: ${entry.target}` : "Local"}
              </span>
            </button>
          ))}
          {!results.length && (
            <div className="no-commands">
              {entries.length
                ? "No matching workspaces"
                : "No recent workspaces yet"}
            </div>
          )}
        </div>
        <div className="palette-footer">
          <span>
            ↑ ↓ navigate · Enter{" "}
            {removing ? "remove from history" : "open in new window"}
          </span>
          <span>{entries.length} recent</span>
        </div>
      </div>
    </div>
  );
}
