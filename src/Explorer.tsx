import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  RefreshCw,
  FolderOpen,
  ArrowUpRight,
} from "lucide-react";
import { basename, dirname, type Entry, type ConnectionState } from "./types";
type Listing = { entries: Entry[]; path: string; next: number | null };
import { FileIcon } from "./FileIcon";
export { FileIcon } from "./FileIcon";
export default function Explorer({
  root,
  selected,
  activation,
  focusSelected = false,
  visible,
  caseInsensitive,
  connection,
  cutPath,
  revision,
  onOpen,
  onFolder,
  onRefresh,
  onError,
  onCommand,
  onContext,
}: {
  root: string;
  selected?: string;
  activation: number;
  focusSelected?: boolean;
  visible: boolean;
  caseInsensitive: boolean;
  connection: ConnectionState;
  cutPath?: string;
  revision: number;
  onOpen(path: string): void;
  onFolder(): void;
  onRefresh(): void;
  onError(message: string): void;
  onCommand(id: string, args?: Record<string, unknown>): void;
  onContext(path: string, directory: boolean, x: number, y: number): void;
}) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [rootError, setRootError] = useState("");
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const tree = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<{
    path: string;
    attempted: Set<string>;
  } | null>(null);
  const pathKey = (path: string) => {
    const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const activeBranch = (path: string) =>
    !!selected &&
    (pathKey(selected) === pathKey(path) ||
      pathKey(selected).startsWith(pathKey(path).replace(/\/$/, "") + "/"));
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
  function drop(event: React.DragEvent, directory: string) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    if (event.dataTransfer.files.length) {
      onCommand("file.import", {
        directory,
        paths: window.lwr.droppedPaths(Array.from(event.dataTransfer.files)),
      });
      return;
    }
    const raw =
      event.dataTransfer.getData("application/owlet-file") ||
      event.dataTransfer.getData("application/lwr-tab");
    if (!raw) return;
    try {
      const { path } = JSON.parse(raw);
      onCommand("file.move", { path, directory });
    } catch {}
  }
  async function load(path: string, offset = 0) {
    if (
      !path ||
      currentRoot.current !== root ||
      connectionRef.current.status !== "connected"
    )
      return;
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
        connectionRef.current.status !== "connected" ||
        /ssh:|spawn ssh|Connection (?:closed|timed out)/i.test(message)
      ) {
        onError(message);
        return;
      }
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
  }, [revision, connection.status]);
  useEffect(() => {
    const prefix = pathKey(root).replace(/\/$/, "") + "/";
    // Virtual documents and files outside this workspace have no tree row.
    setReveal(
      visible && root && selected && pathKey(selected).startsWith(prefix)
        ? { path: selected, attempted: new Set() }
        : null,
    );
  }, [root, selected, activation, visible, revision]);
  useEffect(() => {
    if (!reveal || reveal.path !== selected || !visible) return;
    const parts = reveal.path
      .replaceAll("\\", "/")
      .slice(root.replaceAll("\\", "/").replace(/\/+$/, "").length)
      .split("/")
      .filter(Boolean);
    let parent = root;
    const parents = new Set([root]);
    const expandParents = () => {
      if ([...parents].some((path) => !expandedRef.current.has(path))) {
        const next = new Set([...expandedRef.current, ...parents]);
        expandedRef.current = next;
        setExpanded(next);
        return true;
      }
      return false;
    };
    const request = (path: string, offset = 0) => {
      expandParents();
      if (inFlight.current.has(path)) return;
      const key = JSON.stringify([path, offset]);
      // A failed or invalidated page must not turn a missing file into a retry loop.
      if (reveal.attempted.has(key)) return;
      reveal.attempted.add(key);
      void load(path, offset);
    };
    for (let index = 0; index < parts.length; index++) {
      const listing = listings[parent];
      if (!listing) {
        request(parent);
        return;
      }
      const entry = listing.entries.find((item) =>
        caseInsensitive
          ? item.name.toLowerCase() === parts[index].toLowerCase()
          : item.name === parts[index],
      );
      if (!entry) {
        if (listing.next !== null) request(parent, listing.next);
        else setReveal(null);
        return;
      }
      if (index < parts.length - 1) {
        if (!entry.directory) {
          setReveal(null);
          return;
        }
        parent = entry.path;
        parents.add(parent);
      } else {
        if (expandParents()) return;
        // Refresh can temporarily replace a paginated listing with its first
        // page. Finish only after the ancestor requests have settled.
        if (
          [...parents].some(
            (path) => loading.has(path) || inFlight.current.has(path),
          )
        )
          return;
        const row = [
          ...(tree.current?.querySelectorAll<HTMLElement>("[data-file-path]") ||
            []),
        ].find(
          (item) => pathKey(item.dataset.filePath!) === pathKey(reveal.path),
        );
        if (!row) return; // Expanded parents render on the next React commit.
        const frame = requestAnimationFrame(() => {
          const bounds = row.getBoundingClientRect(),
            viewport = tree.current!.getBoundingClientRect();
          if (bounds.bottom > viewport.bottom)
            tree.current!.scrollTop += bounds.bottom - viewport.bottom;
          else if (bounds.top < viewport.top)
            tree.current!.scrollTop -= viewport.top - bounds.top;
          // Failed previews intentionally return keyboard focus to the file row.
          if (focusSelected) row.focus({ preventScroll: true });
          setReveal(null);
        });
        return () => cancelAnimationFrame(frame);
      }
    }
  }, [reveal, selected, visible, listings, expanded, loading, focusSelected]);
  useEffect(() => {
    const action = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        ["collapse", "collapseFolder", "toggleFolder"].includes(detail.action)
      )
        setReveal(null);
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
          .filter(
            (entry) =>
              hidden || !entry.name.startsWith(".") || activeBranch(entry.path),
          )
          .map((entry) => (
            <div key={entry.path}>
              <button
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copyMove";
                  event.dataTransfer.setData(
                    "application/owlet-file",
                    JSON.stringify({
                      path: entry.path,
                      directory: entry.directory,
                    }),
                  );
                }}
                onDragEnd={() => setDropTarget(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDropTarget(entry.directory ? entry.path : path);
                  event.dataTransfer.dropEffect =
                    event.dataTransfer.types.includes("Files")
                      ? "copy"
                      : "move";
                }}
                onDrop={(event) =>
                  drop(event, entry.directory ? entry.path : path)
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onContext(
                    entry.path,
                    entry.directory,
                    event.clientX,
                    event.clientY,
                  );
                }}
                className={`tree-row ${selected && pathKey(selected) === pathKey(entry.path) ? "selected" : ""} ${cutPath === entry.path ? "cut-item" : ""} ${dropTarget === entry.path && entry.directory ? "drop-target" : ""}`}
                data-file-path={entry.path}
                aria-current={
                  selected && pathKey(selected) === pathKey(entry.path)
                    ? true
                    : undefined
                }
                style={{
                  paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-12))`,
                }}
                title={entry.path}
                onKeyDown={(event) => {
                  if (
                    !(event.ctrlKey || event.metaKey) ||
                    event.altKey ||
                    event.shiftKey
                  )
                    return;
                  const action = (
                    { x: "cut", c: "copy", v: "paste" } as Record<
                      string,
                      string
                    >
                  )[event.key.toLowerCase()];
                  if (!action) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onCommand(
                    `file.${action}`,
                    action === "paste"
                      ? { directory: entry.directory ? entry.path : path }
                      : { path: entry.path },
                  );
                }}
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
    <aside
      className="explorer"
      onContextMenu={(event) => {
        event.preventDefault();
        if (root) onContext(root, true, event.clientX, event.clientY);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDropTarget(root);
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
          "Files",
        )
          ? "copy"
          : "move";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropTarget(null);
      }}
      onDrop={(event) => {
        if (root) drop(event, root);
      }}
    >
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
      <div
        className={`project-label ${dropTarget === root ? "drop-target" : ""}`}
        title={root}
      >
        <ChevronDown size={14} />
        <span>{root ? basename(root) : "No folder opened"}</span>
      </div>
      <div
        className="tree"
        ref={tree}
        data-testid="explorer-tree"
        data-ready={connection.status === "connected" && !!listings[root]}
      >
        {connection.status !== "connected" ? (
          <p className="tree-hint" role="status">
            {connection.status === "connecting"
              ? "Connecting to workspace…"
              : connection.retryDelay
                ? "Connection lost. Retrying automatically…"
                : "Connection unavailable. Reconnect to load this folder."}
          </p>
        ) : rootError ? (
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
