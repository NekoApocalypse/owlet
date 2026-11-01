import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  FileCode,
  Image,
  RefreshCw,
  FolderOpen,
  ArrowUpRight,
} from "lucide-react";
import { basename, isImage, isMarkdown, type Entry } from "./types";
type Listing = { entries: Entry[]; path: string; next: number | null };
export function FileIcon({ path, size = 15 }: { path: string; size?: number }) {
  return isImage(path) ? (
    <Image size={size} className="image-icon" />
  ) : isMarkdown(path) ? (
    <FileText size={size} className="markdown-icon" />
  ) : (
    <FileCode size={size} className="code-icon" />
  );
}
export default function Explorer({
  root,
  selected,
  revision,
  onOpen,
  onFolder,
  onRefresh,
  onError,
  onCommand,
}: {
  root: string;
  selected?: string;
  revision: number;
  onOpen(path: string): void;
  onFolder(): void;
  onRefresh(): void;
  onError(message: string): void;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  async function load(path: string, offset = 0) {
    setLoading((previous) => new Set(previous).add(path));
    try {
      const listing = await window.lwr.remote<Listing>("list", {
        path,
        offset,
      });
      setListings((previous) => ({
        ...previous,
        [path]: {
          ...listing,
          entries: offset
            ? [...(previous[path]?.entries || []), ...listing.entries]
            : listing.entries,
        },
      }));
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    }
  }
  useEffect(() => {
    setListings({});
    setExpanded(new Set([root]));
    if (root) void load(root);
  }, [root]);
  useEffect(() => {
    if (!root) return;
    void load(root);
    for (const dir of expanded) if (dir !== root) void load(dir);
  }, [revision]);
  useEffect(() => {
    const action = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.action === "hidden")
        setHidden((value) =>
          typeof detail.visible === "boolean" ? detail.visible : !value,
        );
      if (detail.action === "collapse") setExpanded(new Set([root]));
      if (detail.action === "collapseFolder")
        setExpanded((previous) => {
          const next = new Set(previous);
          next.delete(detail.path);
          return next;
        });
      if (detail.action === "toggleFolder") toggle(detail.path);
      if (detail.action === "loadMore") {
        const next = listings[detail.path]?.next;
        if (next != null && !loading.has(detail.path))
          void load(detail.path, next);
      }
      if (detail.action === "expand" && detail.path) {
        setExpanded((previous) => new Set(previous).add(detail.path));
        void load(detail.path);
      }
    };
    window.addEventListener("lwr-explorer", action);
    return () => window.removeEventListener("lwr-explorer", action);
  }, [root, listings, expanded, loading]);
  const toggle = (path: string) => {
    const opened = expanded.has(path);
    setExpanded((previous) => {
      const next = new Set(previous);
      opened ? next.delete(path) : next.add(path);
      return next;
    });
    if (!opened && !listings[path]) void load(path);
  };
  function entries(path: string, depth: number) {
    const listing = listings[path];
    if (!listing)
      return (
        <div
          className="tree-hint"
          style={{
            paddingLeft: `calc(var(--space-16) + ${depth} * var(--space-12))`,
          }}
        >
          {loading.has(path) ? "Loading…" : "No listing"}
        </div>
      );
    return (
      <>
        {listing.entries
          .filter((entry) => hidden || !entry.name.startsWith("."))
          .map((entry) => (
            <div key={entry.path}>
              <button
                className={`tree-row ${selected === entry.path ? "selected" : ""}`}
                style={{
                  paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-12))`,
                }}
                title={entry.path}
                onClick={() =>
                  entry.directory
                    ? onCommand("explorer.toggleFolder", { path: entry.path })
                    : onOpen(entry.path)
                }
              >
                {entry.directory ? (
                  <>
                    {expanded.has(entry.path) ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    <Folder size={15} className="folder-icon" />
                  </>
                ) : (
                  <>
                    <span className="tree-spacer" />
                    <FileIcon path={entry.path} />
                  </>
                )}
                <span>{entry.name}</span>
                {entry.symlink && <ArrowUpRight size={10} />}
              </button>
              {entry.directory &&
                expanded.has(entry.path) &&
                entries(entry.path, depth + 1)}
            </div>
          ))}
        {listing.next !== null && (
          <button
            className="tree-more"
            disabled={loading.has(path)}
            onClick={() => onCommand("explorer.loadMore", { path })}
          >
            Load next 100 entries
          </button>
        )}
        {listing.entries.length === 0 && (
          <p className="tree-hint">Empty directory</p>
        )}
      </>
    );
  }
  return (
    <aside className="explorer">
      <div className="section-label">
        <span>EXPLORER</span>
        <div className="actions">
          <button
            title="Open folder in new window"
            aria-label="Open folder"
            onClick={onFolder}
          >
            <FolderOpen size={15} />
          </button>
          <button
            title="Refresh Explorer"
            aria-label="Refresh Explorer"
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="project-label" title={root}>
        <ChevronDown size={14} />
        <span>{basename(root) || "Workspace"}</span>
      </div>
      <div
        className="tree"
        data-testid="explorer-tree"
        data-ready={!!listings[root]}
      >
        {root ? (
          entries(root, 0)
        ) : (
          <p className="tree-hint">Connecting to your workspace…</p>
        )}
      </div>
      <label className="hidden-toggle">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) =>
            onCommand("explorer.hidden", { visible: event.target.checked })
          }
        />{" "}
        Show hidden files
      </label>
    </aside>
  );
}
