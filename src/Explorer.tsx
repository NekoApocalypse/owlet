import { useEffect, useRef, useState } from "react";
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
import { basename, dirname, isImage, isMarkdown, type Entry } from "./types";
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
  const [rootError, setRootError] = useState("");
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const currentRoot = useRef(root);
  currentRoot.current = root;
  const pending = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const invalidated = useRef(new Map<string, number>());
  const generation = useRef(0);
  const reported = useRef(new Map<string, string>());
  const within = (candidate: string, parent: string) =>
    candidate === parent ||
    candidate.startsWith(parent.replace(/\/$/, "") + "/");
  const obsolete = (path: string, started: number) =>
    [...invalidated.current].some(
      ([parent, at]) => at > started && within(path, parent),
    );
  function forget(path: string) {
    invalidated.current.set(path, ++generation.current);
    const next = new Set(
      [...expandedRef.current].filter((item) => !within(item, path)),
    );
    if (path === root) next.add(root);
    expandedRef.current = next;
    setExpanded(next);
    setListings((previous) =>
      Object.fromEntries(
        Object.entries(previous)
          .filter(([key]) => !within(key, path))
          .map(([key, listing]) => [
            key,
            {
              ...listing,
              entries: listing.entries.filter(
                (entry) => !within(entry.path, path),
              ),
            },
          ]),
      ),
    );
  }
  async function load(path: string, offset = 0) {
    if (!path || currentRoot.current !== root) return;
    if (inFlight.current.has(path)) {
      pending.current.add(path);
      return;
    }
    inFlight.current.add(path);
    const started = generation.current;
    setLoading((previous) => new Set(previous).add(path));
    try {
      const listing = await window.lwr.remote<Listing>("list", {
        path,
        offset,
      });
      if (currentRoot.current !== root || obsolete(path, started)) return;
      reported.current.delete(path);
      if (path === root) setRootError("");
      // Only a complete first page proves a child is gone. Paginated omissions
      // are not deletions. In-flight responses from removed subtrees are ignored.
      if (offset === 0 && listing.next === null) {
        for (const expandedPath of [...expandedRef.current]) {
          if (
            expandedPath !== root &&
            dirname(expandedPath) === path &&
            !listing.entries.some(
              (entry) => entry.directory && entry.path === expandedPath,
            )
          )
            forget(expandedPath);
        }
      }
      listing.entries = listing.entries.filter(
        (entry) => !obsolete(entry.path, started),
      );
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
      if (currentRoot.current !== root || obsolete(path, started)) return;
      const message = String(error);
      if (
        /ENOENT|ENOTDIR|\[Errno (?:2|20)\]|No such file or directory|not a directory/i.test(
          message,
        )
      ) {
        forget(path);
        if (path === root)
          setRootError(
            "This workspace folder is no longer available. It may have been moved or renamed. Open its new location, or refresh to retry.",
          );
        else {
          const parent = dirname(path);
          if (within(parent, root)) void load(parent);
        }
      } else {
        if (path === root) setRootError(message.replace(/^Error: /, ""));
        if (reported.current.get(path) !== message) {
          reported.current.set(path, message);
          onError(message);
        }
      }
    } finally {
      inFlight.current.delete(path);
      setLoading((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
      if (
        pending.current.delete(path) &&
        currentRoot.current === root &&
        (path === root || expandedRef.current.has(path))
      )
        void load(path);
    }
  }
  useEffect(() => {
    setListings({});
    setRootError("");
    invalidated.current.clear();
    reported.current.clear();
    expandedRef.current = new Set([root]);
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
        <span>{root ? basename(root) : "No folder opened"}</span>
      </div>
      <div
        className="tree"
        data-testid="explorer-tree"
        data-ready={!!listings[root]}
      >
        {rootError ? (
          <p className="tree-hint" role="status">
            {rootError}
          </p>
        ) : root ? (
          entries(root, 0)
        ) : (
          <p className="tree-hint">Open a folder from the File menu.</p>
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
