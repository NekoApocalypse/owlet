import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PanelLeft,
  Columns2,
  Rows2,
  TerminalSquare,
  Save,
  X,
  Plus,
  RefreshCw,
  FolderOpen,
  ChevronRight,
  ChevronsLeftRight,
  BookOpen,
  Code2,
  PanelTop,
  Wifi,
  WifiOff,
  Check,
  AlertTriangle,
  Maximize,
  Minus,
  ArrowUpRight,
} from "lucide-react";
import Explorer, { FileIcon } from "./Explorer";
import Editor, { editorAction } from "./Editor";
import CommandPalette, { useCommands } from "./commands";
import RecentWorkspaces from "./RecentWorkspaces";
import type { RecentWorkspace } from "./types";
import { useProjectAppearance } from "./projectAppearance";
import {
  basename,
  dirname,
  isImage,
  isMarkdown,
  type ConnectionState,
  type Document,
  type Group,
  type Layout,
  type RemoteFile,
} from "./types";
import {
  groups,
  mapGroup,
  removeGroup,
  replaceGroup,
  resizeSplit,
} from "./layout";
const Preview = lazy(() => import("./Preview"));
const TerminalPane = lazy(() => import("./TerminalPane"));
const owletLogo = new URL("../assets/icon.png", import.meta.url).href;
let nextGroup = 2,
  nextSplit = 1;
type Prompt = {
  token?: string;
  title: string;
  detail: string;
  confirm: string;
  action(): void;
};

function Split({
  axis,
  ratio,
  onResize,
  first,
  second,
}: {
  axis: "row" | "column";
  ratio: number;
  onResize(value: number): void;
  first: ReactNode;
  second: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  return (
    <div
      className={`split split-${axis}`}
      ref={host}
      style={{ flexDirection: axis }}
    >
      <div className="split-child" style={{ flex: `${ratio} 1 0%` }}>
        {first}
      </div>
      <div
        className="split-handle"
        role="separator"
        aria-label={`Resize ${axis === "row" ? "vertical" : "horizontal"} split`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = host.current!.getBoundingClientRect();
          const value =
            axis === "row"
              ? (event.clientX - rect.left) / rect.width
              : (event.clientY - rect.top) / rect.height;
          onResize(Math.max(0.08, Math.min(0.92, value)));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <div className="split-child" style={{ flex: `${1 - ratio} 1 0%` }}>
        {second}
      </div>
    </div>
  );
}
function SourcePreview({
  first,
  second,
  ratio,
  onResize,
}: {
  first: ReactNode;
  second: ReactNode;
  ratio: number;
  onResize(value: number): void;
}) {
  return (
    <Split
      axis="row"
      ratio={ratio}
      onResize={onResize}
      first={first}
      second={second}
    />
  );
}
function ImageViewer({
  document,
  onCommand,
}: {
  document: Document;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const action = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.path !== document.path) return;
      setZoom((value) =>
        detail.action === "fit"
          ? null
          : detail.action === "in"
            ? (value || 1) + 0.25
            : Math.max(0.1, (value || 1) - 0.25),
      );
    };
    window.addEventListener("lwr-image", action);
    return () => window.removeEventListener("lwr-image", action);
  }, [document.path]);
  return (
    <div className="image-viewer">
      <div className="image-controls">
        <button onClick={() => onCommand("image.fit", { path: document.path })}>
          <Maximize size={14} /> Fit
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => onCommand("image.zoomOut", { path: document.path })}
        >
          <Minus size={14} />
        </button>
        <span>{zoom ? `${Math.round(zoom * 100)}%` : "Fit"}</span>
        <button
          aria-label="Zoom in"
          onClick={() => onCommand("image.zoomIn", { path: document.path })}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="image-canvas">
        <img
          alt={basename(document.path)}
          src={document.image}
          style={
            zoom
              ? { maxWidth: "none", maxHeight: "none", zoom }
              : { maxWidth: "95%", maxHeight: "90%" }
          }
        />
      </div>
    </div>
  );
}

export default function App() {
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [recentPicker, setRecentPicker] = useState<"open" | "remove" | null>(
    null,
  );
  const [connection, setConnection] = useState<ConnectionState>({
    status: "connecting",
    target: "Local",
    kind: "local",
  });
  const [root, setRoot] = useState("");
  const [documents, setDocuments] = useState<Record<string, Document>>({});
  const [viewModes, setViewModes] = useState<Record<string, Document["mode"]>>(
    {},
  );
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>(
    {},
  );
  const [layout, setLayout] = useState<Layout>({
    kind: "group",
    group: { id: 1, tabs: [] },
  });
  const [activeGroup, setActiveGroup] = useState(1);
  const [sidebar, setSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [terminalRestart, setTerminalRestart] = useState(0);
  const [vimMode, setVimMode] = useState(
    localStorage.getItem("lwr-vim") === "true",
  );
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [prompt, updatePrompt] = useState<Prompt | null>(null);
  const setPrompt = (value: Prompt | null) =>
    updatePrompt(value ? { ...value, token: crypto.randomUUID() } : null);
  const [folderInput, setFolderInput] = useState<string | null>(null);
  const [sshInput, setSSHInput] = useState<{
    target: string;
    root: string;
  } | null>(null);
  const [comparison, setComparison] = useState<string | null>(null);
  const [terminalNeedsRestart, setTerminalNeedsRestart] = useState(false);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [pathPrompt, setPathPrompt] = useState<{
    title: string;
    value: string;
    multiline?: boolean;
    action(path: string): unknown;
  } | null>(null);
  const docsRef = useRef(documents),
    layoutRef = useRef(layout),
    groupRef = useRef(activeGroup),
    connectionRef = useRef(connection);
  docsRef.current = documents;
  layoutRef.current = layout;
  groupRef.current = activeGroup;
  connectionRef.current = connection;
  const opening = useRef(new Map<string, Promise<Document | undefined>>());
  const saving = useRef(new Set<string>());
  const dirty = Object.values(documents).some((doc) => doc.text !== doc.saved);
  const currentGroup =
    groups(layout).find((group) => group.id === activeGroup) ||
    groups(layout)[0];
  const activeDocument = currentGroup.active
    ? documents[currentGroup.active]
    : undefined;
  const current = activeDocument
    ? {
        ...activeDocument,
        mode:
          viewModes[`${currentGroup.id}:${activeDocument.path}`] ||
          activeDocument.mode,
      }
    : undefined;
  const setMode = (
    path: string,
    mode: Document["mode"],
    group = groupRef.current,
  ) =>
    setViewModes((previous) => ({ ...previous, [`${group}:${path}`]: mode }));
  const report = (error: unknown) =>
    setMessage(
      String(error)
        .replace(/^Error: Error invoking remote method '[^']+': Error: /, "")
        .replace(/^Error: /, ""),
    );
  const patch = (path: string, update: Partial<Document>) => {
    const previous = docsRef.current;
    if (!previous[path]) return;
    const next = { ...previous, [path]: { ...previous[path], ...update } };
    // Save/close chains (including :wq) must observe the saved revision immediately.
    docsRef.current = next;
    setDocuments(next);
  };
  const markBusy = (path: string, value: boolean) =>
    setBusy((previous) => {
      const next = new Set(previous);
      value ? next.add(path) : next.delete(path);
      return next;
    });
  function activate(path: string, group = groupRef.current) {
    setLayout((previous) =>
      mapGroup(previous, group, (value) => ({
        ...value,
        tabs: value.tabs.includes(path) ? value.tabs : [...value.tabs, path],
        active: path,
      })),
    );
    setActiveGroup(group);
  }
  async function openFile(path: string, group = groupRef.current) {
    if (docsRef.current[path]) {
      activate(path, group);
      return;
    }
    let pending = opening.current.get(path);
    if (!pending) {
      pending = (async () => {
        markBusy(path, true);
        try {
          let document: Document;
          if (isImage(path)) {
            const result = await window.lwr.remote<{
              url: string;
              stamp: string;
            }>("image", { path });
            document = {
              path,
              image: result.url,
              stamp: result.stamp,
              text: "",
              saved: "",
              revision: "",
              mode: "preview",
            };
          } else {
            const result = await window.lwr.remote<RemoteFile>("read", {
              path,
            });
            const text = result.text.replace(/\r\n/g, "\n");
            document = {
              ...result,
              text,
              saved: text,
              lineEnding: result.text.includes("\r\n") ? "\r\n" : "\n",
              mode: isMarkdown(path) ? "preview" : "source",
            };
          }
          setDocuments((previous) => ({ ...previous, [path]: document }));
          return document;
        } catch (error) {
          report(error);
          return undefined;
        } finally {
          markBusy(path, false);
          opening.current.delete(path);
        }
      })();
      opening.current.set(path, pending);
    }
    if (await pending) activate(path, group);
  }
  async function saveFile(
    path: string,
    replacementRevision?: string,
  ): Promise<boolean> {
    const doc = docsRef.current[path];
    if (!doc || doc.image) return false;
    if (doc.text === doc.saved && !replacementRevision) return true;
    if (saving.current.has(path)) return false;
    saving.current.add(path);
    markBusy(path, true);
    try {
      const text =
        doc.lineEnding === "\r\n" ? doc.text.replace(/\n/g, "\r\n") : doc.text;
      const result = await window.lwr.remote<{
        revision: string;
        stamp: string;
      }>("save", { path, text, revision: replacementRevision || doc.revision });
      patch(path, {
        revision: result.revision,
        stamp: result.stamp,
        saved: doc.text,
        conflict: undefined,
        missing: false,
      });
      setMessage(`Saved ${basename(path)}`);
      setComparison(null);
      return true;
    } catch (error) {
      if (String(error).includes("CONFLICT")) {
        try {
          const remote = await window.lwr.remote<RemoteFile>("read", { path });
          patch(path, { conflict: remote });
          setComparison(path);
        } catch (readError) {
          report(readError);
        }
      }
      report(error);
      return false;
    } finally {
      saving.current.delete(path);
      markBusy(path, false);
    }
  }
  async function resolveConflict(
    choice: "local" | "remote",
    args: { path?: string; confirmed?: boolean; revision?: string },
  ) {
    const path = args.path || comparison || current?.path;
    const doc = path ? docsRef.current[path] : undefined;
    if (!doc?.conflict) throw new Error("Open a file with a conflict first.");
    const remote = doc.conflict;
    if (args.confirmed !== true) {
      setComparison(doc.path);
      return { confirmationRequired: true, revision: remote.revision };
    }
    if (args.revision !== remote.revision)
      throw new Error(
        "The compared version changed. Compare again before resolving.",
      );
    if (choice === "local") return saveFile(doc.path, remote.revision);
    const text = remote.text.replace(/\r\n/g, "\n");
    patch(doc.path, {
      ...remote,
      text,
      saved: text,
      conflict: undefined,
      lineEnding: remote.text.includes("\r\n") ? "\r\n" : "\n",
    });
    setComparison(null);
    return true;
  }
  function performClose(path: string, groupId: number, discard = false) {
    const next = mapGroup(layoutRef.current, groupId, (group) => {
      const index = group.tabs.indexOf(path),
        tabs = group.tabs.filter((value) => value !== path);
      return {
        ...group,
        tabs,
        active:
          group.active === path
            ? tabs[Math.min(index, tabs.length - 1)]
            : group.active,
      };
    });
    const empty =
      groups(next).find((group) => group.id === groupId)?.tabs.length === 0;
    const result =
      empty && groups(next).length > 1 ? removeGroup(next, groupId)! : next;
    setLayout(result);
    if (!groups(result).some((group) => group.id === activeGroup))
      setActiveGroup(groups(result)[0].id);
    if (!groups(result).some((group) => group.tabs.includes(path)))
      setDocuments((previous) => {
        const updated = { ...previous };
        delete updated[path];
        return updated;
      });
    else if (discard) patch(path, { text: docsRef.current[path]?.saved || "" });
  }
  function closeFile(path: string, groupId: number) {
    const doc = docsRef.current[path];
    const occurrences = groups(layoutRef.current).filter((group) =>
      group.tabs.includes(path),
    ).length;
    if (doc && doc.text !== doc.saved && occurrences <= 1) {
      setPrompt({
        title: `Discard changes to ${basename(path)}?`,
        detail: "The file has not been updated with these edits.",
        confirm: "Discard changes",
        action: () => performClose(path, groupId),
      });
    } else performClose(path, groupId);
  }
  function splitGroup(group: Group, axis: "row" | "column") {
    const id = nextGroup++;
    if (group.active)
      setViewModes((previous) => ({
        ...previous,
        [`${id}:${group.active}`]:
          previous[`${group.id}:${group.active}`] ||
          documents[group.active!]?.mode ||
          "source",
      }));
    setLayout((previous) =>
      replaceGroup(previous, group.id, {
        kind: "split",
        id: nextSplit++,
        axis,
        ratio: 0.5,
        first: { kind: "group", group },
        second: {
          kind: "group",
          group: {
            id,
            tabs: group.active ? [group.active] : [],
            active: group.active,
          },
        },
      }),
    );
    setActiveGroup(id);
  }
  function moveTab(path: string, source: number, destination: number) {
    if (source === destination) return;
    setLayout((previous) => {
      let next = mapGroup(previous, destination, (group) => ({
        ...group,
        tabs: group.tabs.includes(path) ? group.tabs : [...group.tabs, path],
        active: path,
      }));
      next = mapGroup(next, source, (group) => {
        const tabs = group.tabs.filter((item) => item !== path);
        return {
          ...group,
          tabs,
          active: group.active === path ? tabs[0] : group.active,
        };
      });
      if (groups(next).find((group) => group.id === source)?.tabs.length === 0)
        next = removeGroup(next, source) || next;
      return next;
    });
    setActiveGroup(destination);
  }
  const connected = connection.status === "connected";
  const local = connection.kind === "local";
  const appearance = useProjectAppearance(
    root,
    connection.target,
    connected,
    report,
  );
  const { api: commandApi, execute } = useCommands(
    [
      ...appearance.commands,
      {
        id: "project.settings.open",
        title: "Project: Open .owlet/settings.json",
        enabled: connected && !!root,
        run: async () => {
          const path = root + "/.owlet/settings.json";
          const [stat] = await window.lwr.remote<Array<{ error?: string }>>(
            "stats",
            { paths: [path] },
          );
          if (stat.error && !stat.error.includes("No such file or directory"))
            throw new Error(stat.error);
          if (stat.error)
            await commandApi.execute("project.color.set", {
              color: appearance.color,
              revision: null,
            });
          await openFile(path);
        },
      },
      {
        id: "window.minimize",
        title: "Window: Minimize",
        run: () => window.lwr.windowAction("minimize"),
      },
      {
        id: "window.maximize",
        title: "Window: Toggle Maximize",
        run: () => window.lwr.windowAction("maximize"),
      },
      {
        id: "commands.show",
        title: "Show Command Palette",
        shortcut: "Ctrl+Shift+P / F1",
        run: () => setPaletteVisible(true),
      },
      {
        id: "menu.file",
        title: "File: Show File Menu",
        run: () => window.lwr.fileMenu(),
      },
      {
        id: "window.newEmpty",
        title: "Window: New Window",
        shortcut: "Ctrl+Shift+N",
        run: () => window.lwr.newWindow(),
      },
      {
        id: "workspace.openRecent",
        title: "Workspace: Open Recent…",
        keywords: ["Recently Opened Windows", "Recent Folders"],
        shortcut: "Ctrl+Alt+R",
        parameters: {
          id: "Optional ID from workspace.recent; omit to choose a workspace",
        },
        run: async (args) => {
          if (args.id !== undefined) {
            await window.lwr.openRecent(args.id);
            setRecentPicker(null);
          } else {
            setRecent(await window.lwr.recent());
            setRecentPicker("open");
          }
        },
      },
      {
        id: "workspace.recent",
        title: "Workspace: Copy Recent Workspace List",
        parameters: { readOnly: "true returns history without copying" },
        run: async (args) => {
          const entries = await window.lwr.recent();
          if (!args.readOnly)
            await navigator.clipboard.writeText(
              JSON.stringify(entries, null, 2),
            );
          return entries;
        },
      },
      {
        id: "workspace.removeRecent",
        title: "Workspace: Remove from Recently Opened…",
        parameters: {
          id: "Optional history ID; removes the entry, never the folder",
        },
        run: async (args) => {
          if (args.id !== undefined)
            setRecent(await window.lwr.removeRecent(args.id));
          else {
            setRecent(await window.lwr.recent());
            setRecentPicker("remove");
          }
        },
      },
      {
        id: "workspace.clearRecent",
        title: "Workspace: Clear Recently Opened…",
        run: () =>
          setPrompt({
            title: "Clear recently opened workspaces?",
            detail:
              "This clears the list on this laptop. Your folders and open windows are unchanged.",
            confirm: "Clear history",
            action: async () => {
              setRecent(await window.lwr.clearRecent());
            },
          }),
      },
      {
        id: "window.openFolder",
        title: local
          ? "Window: Open Local Folder in New Window"
          : "Window: Open Remote Folder in New Window",
        run: (args) =>
          args.path
            ? window.lwr.openWindow(args.path)
            : local
              ? window.lwr.openLocal()
              : setFolderInput(root),
      },
      {
        id: "workspace.openLocal",
        title: "Workspace: Open Local Folder…",
        run: (args) => window.lwr.openLocal(args.path),
      },
      {
        id: "workspace.openSSH",
        title: "Remote: Connect to Remote… (SSH)",
        keywords: ["Open Remote", "Connect over SSH"],
        parameters: {
          target: "SSH host alias or user@host; omit to open connection dialog",
          path: "Optional remote directory",
        },
        run: (args) =>
          args.target
            ? window.lwr.openSSH(args.target, args.path)
            : setSSHInput({ target: local ? "" : connection.target, root: "" }),
      },
      {
        id: "window.new",
        title: "Window: New Window at Current Project",
        enabled: connected && !!root,
        run: () => window.lwr.openWindow(root),
      },
      {
        id: "window.reload",
        title: "Window: Reload Window",
        shortcut: "Ctrl+R",
        run: () => window.lwr.reload(),
      },
      {
        id: "window.close",
        title: "Window: Close Window",
        run: () => window.lwr.closeWindow(),
      },
      {
        id: "window.fullscreen",
        title: "Window: Toggle Full Screen",
        shortcut: "F11",
        run: () => window.lwr.fullscreen(),
      },
      ...(["in", "out", "reset"] as const).map((direction) => ({
        id: `view.zoom.${direction}`,
        title: `View: Zoom ${direction === "reset" ? "Reset" : direction === "in" ? "In" : "Out"}`,
        run: () => window.lwr.zoom(direction),
      })),
      {
        id: "connection.reconnect",
        title: "Connection: Reconnect SSH",
        enabled: !local && !connected,
        run: reconnect,
      },
      {
        id: "connection.disconnect",
        title: "Connection: Disconnect SSH (Ends Direct Shells)",
        enabled: !local && connected,
        run: () => window.lwr.disconnect(),
      },
      {
        id: "explorer.toggle",
        title: "View: Toggle Explorer",
        shortcut: "Ctrl+Shift+E",
        run: () => setSidebar((value) => !value),
      },
      {
        id: "explorer.refresh",
        title: "Explorer: Refresh Files and Images",
        run: () => setRefresh((value) => value + 1),
      },
      {
        id: "explorer.widen",
        title: "Explorer: Increase Width",
        run: () => setSidebarWidth((value) => Math.min(500, value + 40)),
      },
      {
        id: "explorer.narrow",
        title: "Explorer: Decrease Width",
        run: () => setSidebarWidth((value) => Math.max(160, value - 40)),
      },
      {
        id: "explorer.hidden",
        title: "Explorer: Toggle Hidden Files",
        run: (args) =>
          window.dispatchEvent(
            new CustomEvent("lwr-explorer", {
              detail: { action: "hidden", visible: args.visible },
            }),
          ),
      },
      {
        id: "explorer.setWidth",
        title: "Explorer: Set Width…",
        parameters: { width: "Width in pixels, from 160 to 500" },
        run: (args) => {
          const apply = (value: number) => {
            if (!Number.isFinite(value))
              throw new Error("Enter a numeric width");
            setSidebarWidth(Math.max(160, Math.min(500, value)));
          };
          return args.width === undefined
            ? setPathPrompt({
                title: "Explorer width (160–500 px)",
                value: String(sidebarWidth),
                action: (value) => apply(Number(value)),
              })
            : apply(args.width);
        },
      },
      ...(["toggleFolder", "collapseFolder", "loadMore"] as const).map(
        (action) => ({
          id: `explorer.${action}`,
          title: `Explorer: ${{ toggleFolder: "Toggle Folder", collapseFolder: "Collapse Folder", loadMore: "Load Next 100 Entries" }[action]}…`,
          parameters: {
            path: "Absolute directory path; omitted opens a prompt",
          },
          run: (args: Record<string, any>) => {
            const apply = (path: string) =>
              window.dispatchEvent(
                new CustomEvent("lwr-explorer", { detail: { action, path } }),
              );
            return args.path
              ? apply(args.path)
              : setPathPrompt({
                  title: "Folder path",
                  value: root,
                  action: apply,
                });
          },
        }),
      ),
      {
        id: "explorer.collapse",
        title: "Explorer: Collapse All Folders",
        run: () =>
          window.dispatchEvent(
            new CustomEvent("lwr-explorer", { detail: { action: "collapse" } }),
          ),
      },
      {
        id: "explorer.expand",
        title: "Explorer: Expand Folder by Path…",
        run: (args) => {
          const action = (path: string) =>
            window.dispatchEvent(
              new CustomEvent("lwr-explorer", {
                detail: { action: "expand", path },
              }),
            );
          return args.path
            ? action(args.path)
            : setPathPrompt({
                title: "Expand folder",
                value: root,
                action,
              });
        },
      },
      {
        id: "file.open",
        title: "File: Open File by Path…",
        parameters: {
          path: "Absolute workspace file path; omitted opens a prompt",
          group: "Optional numeric tab-group ID",
        },
        enabled: connected,
        run: (args) =>
          args.path
            ? openFile(args.path, args.group)
            : setPathPrompt({
                title: "Open file",
                value: root + "/",
                action: (path) => openFile(path),
              }),
      },
      {
        id: "file.save",
        title: "File: Save",
        shortcut: "Ctrl+S / :w",
        enabled: !!current && !current.image && connected,
        run: (args) => saveFile(args.path || current!.path),
      },
      {
        id: "file.saveAll",
        title: "File: Save All",
        enabled: connected && dirty,
        run: async () => {
          for (const doc of Object.values(docsRef.current))
            if (doc.text !== doc.saved && !(await saveFile(doc.path))) break;
        },
      },
      {
        id: "file.close",
        title: "File: Close Active Tab",
        shortcut: "Ctrl+W / :q",
        enabled: !!current,
        run: (args) =>
          closeFile(args.path || current!.path, args.group || currentGroup.id),
      },
      {
        id: "file.revert",
        title: "File: Revert to Saved Version",
        enabled: !!current && !current.image && connected,
        run: () =>
          setPrompt({
            title: "Discard edits and reload the saved file?",
            detail: "The saved content will replace your editor buffer.",
            confirm: "Reload saved file",
            action: () => {
              void window.lwr
                .remote<RemoteFile>("read", { path: current!.path })
                .then((result) => {
                  const text = result.text.replace(/\r\n/g, "\n");
                  patch(current!.path, {
                    ...result,
                    text,
                    saved: text,
                    conflict: undefined,
                  });
                })
                .catch(report);
            },
          }),
      },
      {
        id: "file.compare",
        title: "File: Compare with Changed File",
        enabled: !!current?.conflict,
        run: (args) => setComparison(args.path || current!.path),
      },
      {
        id: "file.copyPath",
        title: "File: Copy File Path",
        enabled: !!current,
        run: () => navigator.clipboard.writeText(current!.path),
      },
      ...(["local", "remote"] as const).map((choice) => ({
        id: choice === "local" ? "conflict.replace" : "conflict.useRemote",
        title:
          choice === "local"
            ? "Conflict: Replace Saved File with My Edits…"
            : "Conflict: Use Compared File Version…",
        enabled:
          !!(comparison
            ? documents[comparison]?.conflict
            : current?.conflict) && connected,
        parameters: {
          path: "Optional open file path",
          confirmed:
            "true explicitly approves the displayed choice; omitted opens comparison only",
          revision:
            "Required with confirmed: revision returned by this command or workspace.state conflictRevision",
        },
        run: (args: {
          path?: string;
          confirmed?: boolean;
          revision?: string;
        }) => resolveConflict(choice, args),
      })),
      {
        id: "conflict.keepEditing",
        title: "Conflict: Keep Editing",
        enabled: !!comparison,
        run: () => setComparison(null),
      },
      {
        id: "editor.vim",
        title: "Editor: Toggle Vim Mode",
        run: () => setVimMode((value) => !value),
      },
      {
        id: "file.inspect",
        title: "File: Copy Open Buffer State",
        enabled: !!current,
        parameters: {
          path: "Optional open file path",
          readOnly: "true returns the buffer state without copying",
        },
        run: (args) => {
          const doc = documents[args.path || current!.path];
          if (!doc) throw new Error("File is not open");
          const result = {
            path: doc.path,
            text: doc.text,
            savedText: doc.saved,
            revision: doc.revision,
            dirty: doc.text !== doc.saved,
            image: !!doc.image,
            conflict: doc.conflict,
          };
          if (!args.readOnly)
            void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        id: "editor.setText",
        title: "Editor: Replace Buffer Text…",
        enabled: !!current && !current.image,
        parameters: {
          path: "Optional open file path",
          text: "New unsaved buffer text; omit for a multiline editor",
        },
        run: (args) => {
          const doc = documents[args.path || current!.path];
          if (!doc || doc.image) throw new Error("Choose an open text file");
          const apply = (text: string) => {
            if (typeof text !== "string")
              throw new Error("Text must be a string");
            patch(doc.path, { text });
          };
          return args.text === undefined
            ? setPathPrompt({
                title: "Replace buffer text (not saved)",
                value: doc.text,
                multiline: true,
                action: apply,
              })
            : apply(args.text);
        },
      },
      {
        id: "markdown.resize",
        title: "Markdown: Set Source / Preview Split…",
        enabled: !!current && isMarkdown(current.path),
        parameters: {
          group: "Optional tab group ID",
          path: "Optional Markdown path",
          ratio: "Source fraction, 0.08 to 0.92; omit for a percentage prompt",
        },
        run: (args) => {
          const group = args.group ?? currentGroup.id,
            path = args.path || current!.path;
          const apply = (ratio: number) => {
            if (!Number.isFinite(ratio))
              throw new Error("Enter a numeric split size");
            setMode(path, "both", group);
            setPreviewRatios((previous) => ({
              ...previous,
              [`${group}:${path}`]: Math.max(0.08, Math.min(0.92, ratio)),
            }));
          };
          return args.ratio === undefined
            ? setPathPrompt({
                title: "Source pane percentage (8–92)",
                value: "50",
                action: (value) => apply(Number(value) / 100),
              })
            : apply(args.ratio);
        },
      },
      {
        id: "link.openExternal",
        title: "Link: Open in Browser…",
        parameters: { url: "HTTP or HTTPS URL; omit to enter a URL" },
        run: (args) =>
          args.url
            ? window.lwr.external(args.url)
            : setPathPrompt({
                title: "Open URL in browser",
                value: "https://",
                action: (url) => window.lwr.external(url),
              }),
      },
      {
        id: "markdown.heading",
        title: "Markdown: Go to Heading…",
        enabled: !!current && isMarkdown(current.path),
        parameters: {
          id: "Rendered heading ID",
          group: "Optional tab group ID",
        },
        run: (args) => {
          const apply = (id: string) => {
            const element = document.querySelector(
              `[data-group="${args.group ?? currentGroup.id}"] .markdown-preview [id="${CSS.escape(id)}"]`,
            );
            if (!element)
              throw new Error(
                "Heading is not visible. Open the preview and check the heading ID.",
              );
            element.scrollIntoView({ behavior: "smooth" });
          };
          return args.id
            ? apply(args.id)
            : setPathPrompt({ title: "Heading ID", value: "", action: apply });
        },
      },
      ...(
        [
          "find",
          "findNext",
          "findPrevious",
          "replaceNext",
          "replaceAll",
          "closeFind",
          "undo",
          "redo",
          "selectAll",
          "focus",
        ] as const
      ).map((action) => ({
        id: `editor.${action}`,
        title: `Editor: ${{ find: "Find in File", findNext: "Find Next", findPrevious: "Find Previous", replaceNext: "Replace Next Match", replaceAll: "Replace All Matches", closeFind: "Close Find", undo: "Undo", redo: "Redo", selectAll: "Select All", focus: "Focus Source Editor" }[action]}`,
        enabled: !!current && !current.image,
        parameters: {
          search: "Optional search string",
          replace: "Optional replacement",
          caseSensitive: "Optional boolean",
          regexp: "Optional boolean",
        },
        run: (args: Record<string, any>) => {
          if (current?.mode === "preview") setMode(current.path, "source");
          return new Promise((resolve) =>
            setTimeout(() => {
              document
                .querySelector<HTMLElement>(
                  `[data-group="${currentGroup.id}"] .cm-content`,
                )
                ?.focus();
              resolve(editorAction(action, args));
            }, 50),
          );
        },
      })),
      ...(["source", "preview", "both"] as const).map((mode) => ({
        id: `markdown.${mode}`,
        title: `Markdown: ${{ source: "Show Raw Source", preview: "Show Preview", both: "Show Source and Preview" }[mode]}`,
        enabled: !!current && isMarkdown(current.path),
        run: (args: Record<string, any>) =>
          setMode(args.path || current!.path, mode, args.group),
      })),
      {
        id: "markdown.toggle",
        title: "Markdown: Toggle Preview / Raw Source",
        enabled: !!current && isMarkdown(current.path),
        run: () =>
          setMode(
            current!.path,
            current!.mode === "preview" ? "source" : "preview",
          ),
      },
      {
        id: "group.splitRight",
        title: "Group: Split Right",
        shortcut: "Ctrl+\\",
        run: (args) =>
          splitGroup(
            groups(layoutRef.current).find(
              (group) => group.id === args.group,
            ) || currentGroup,
            "row",
          ),
      },
      {
        id: "group.splitDown",
        title: "Group: Split Down",
        run: (args) =>
          splitGroup(
            groups(layoutRef.current).find(
              (group) => group.id === args.group,
            ) || currentGroup,
            "column",
          ),
      },
      {
        id: "group.next",
        title: "Group: Focus Next Group",
        run: () => {
          const all = groups(layout);
          setActiveGroup(
            all[
              (all.findIndex((group) => group.id === activeGroup) + 1) %
                all.length
            ].id,
          );
        },
      },
      {
        id: "group.focus",
        title: "Group: Focus Group by ID…",
        parameters: { group: "Numeric group ID from workspace.state" },
        run: (args) => {
          const apply = (group: number) => {
            if (!groups(layoutRef.current).some((item) => item.id === group))
              throw new Error("Unknown group ID");
            setActiveGroup(group);
          };
          return args.group === undefined
            ? setPathPrompt({
                title: "Group ID",
                value: String(currentGroup.id),
                action: (value) => apply(Number(value)),
              })
            : apply(args.group);
        },
      },
      {
        id: "tab.activate",
        title: "Tab: Activate Open File…",
        parameters: { path: "Open file path", group: "Optional group ID" },
        enabled: Object.keys(documents).length > 0,
        run: (args) => {
          const apply = (path: string) => {
            const group =
              args.group === undefined
                ? groups(layoutRef.current).find((item) =>
                    item.tabs.includes(path),
                  )
                : groups(layoutRef.current).find(
                    (item) =>
                      item.id === args.group && item.tabs.includes(path),
                  );
            if (!group)
              throw new Error("File is not open in the requested group");
            activate(path, group.id);
          };
          return args.path
            ? apply(args.path)
            : setPathPrompt({
                title: "Open tab path",
                value: current?.path || "",
                action: apply,
              });
        },
      },
      {
        id: "group.moveTab",
        title: "Group: Move Active Tab to Next Group",
        enabled: !!current && groups(layout).length > 1,
        run: (args) => {
          const all = groups(layout);
          moveTab(
            args.path || current!.path,
            args.source || currentGroup.id,
            args.destination ||
              all[
                (all.findIndex((group) => group.id === currentGroup.id) + 1) %
                  all.length
              ].id,
          );
        },
      },
      {
        id: "group.equalize",
        title: "Group: Equalize All Split Sizes",
        run: () => {
          const balance = (node: Layout): Layout =>
            node.kind === "group"
              ? node
              : {
                  ...node,
                  ratio: 0.5,
                  first: balance(node.first),
                  second: balance(node.second),
                };
          setLayout(balance(layout));
        },
      },
      {
        id: "group.resize",
        title: "Group: Set Split Size…",
        enabled: groups(layout).length > 1,
        parameters: {
          id: "Optional split ID; defaults to the active group parent",
          ratio:
            "Fraction between 0.08 and 0.92; omitted prompts for a percentage",
        },
        run: (args) => {
          const parent = (node: Layout): number | undefined =>
            node.kind === "group"
              ? undefined
              : (node.first.kind === "group" &&
                    node.first.group.id === currentGroup.id) ||
                  (node.second.kind === "group" &&
                    node.second.group.id === currentGroup.id)
                ? node.id
                : (parent(node.first) ?? parent(node.second));
          const id = args.id ?? parent(layout);
          const resize = (ratio: number) => {
            if (!Number.isFinite(ratio))
              throw new Error("Enter a number between 8 and 92");
            setLayout((previous) =>
              resizeSplit(previous, id, Math.max(0.08, Math.min(0.92, ratio))),
            );
          };
          if (typeof args.ratio === "number") resize(args.ratio);
          else
            setPathPrompt({
              title: "Split size: first pane percentage (8–92)",
              value: "50",
              action: (value) => resize(Number(value) / 100),
            });
        },
      },
      {
        id: "tab.next",
        title: "Tab: Next Tab",
        enabled: currentGroup.tabs.length > 1,
        run: () =>
          activate(
            currentGroup.tabs[
              (currentGroup.tabs.indexOf(currentGroup.active!) + 1) %
                currentGroup.tabs.length
            ],
            currentGroup.id,
          ),
      },
      {
        id: "tab.previous",
        title: "Tab: Previous Tab",
        enabled: currentGroup.tabs.length > 1,
        run: () =>
          activate(
            currentGroup.tabs[
              (currentGroup.tabs.indexOf(currentGroup.active!) +
                currentGroup.tabs.length -
                1) %
                currentGroup.tabs.length
            ],
            currentGroup.id,
          ),
      },
      {
        id: "workspace.state",
        title: "Workspace: Copy State Summary",
        parameters: {
          readOnly: "true returns state without copying to clipboard",
        },
        run: (args) => {
          const summary = {
            root,
            connection: connection.status,
            vimMode,
            layout,
            viewModes,
            activeGroup,
            previewRatios,
            confirmation: prompt
              ? {
                  title: prompt.title,
                  detail: prompt.detail,
                  token: prompt.token,
                }
              : null,
            sidebar: { visible: sidebar, width: sidebarWidth },
            terminal: {
              visible: terminalVisible,
              height: terminalHeight,
              needsRestart: terminalNeedsRestart,
            },
            documents: Object.values(documents).map((doc) => ({
              path: doc.path,
              dirty: doc.text !== doc.saved,
              conflict: !!doc.conflict,
              conflictRevision: doc.conflict?.revision,
            })),
          };
          if (!args.readOnly)
            void navigator.clipboard.writeText(
              JSON.stringify(summary, null, 2),
            );
          return summary;
        },
      },
      {
        id: "message.dismiss",
        title: "Notifications: Dismiss Message",
        enabled: !!message,
        run: () => setMessage(""),
      },
      {
        id: "confirmation.accept",
        title: "Confirmation: Review Pending Action…",
        enabled: !!prompt,
        parameters: {
          token:
            "Current confirmation token from workspace.state; omission returns the pending question without approving",
        },
        run: (args) => {
          if (!prompt) throw new Error("No pending confirmation");
          if (args.token === undefined)
            return {
              title: prompt.title,
              detail: prompt.detail,
              token: prompt.token,
            };
          if (args.token !== prompt.token)
            throw new Error("Confirmation changed; review it again");
          const action = prompt.action;
          setPrompt(null);
          return action();
        },
      },
      {
        id: "confirmation.cancel",
        title: "Confirmation: Cancel Pending Action",
        enabled: !!prompt,
        run: () => setPrompt(null),
      },
      {
        id: "group.closeEmpty",
        title: "Group: Close Active Empty Group",
        enabled: currentGroup.tabs.length === 0 && groups(layout).length > 1,
        run: (args) => {
          const group = groups(layout).find(
            (item) => item.id === (args.group ?? currentGroup.id),
          );
          if (!group || group.tabs.length || groups(layout).length === 1)
            throw new Error("Choose an empty group; keep at least one group");
          const next = removeGroup(layout, group.id)!;
          setLayout(next);
          setActiveGroup(groups(next)[0].id);
        },
      },
      {
        id: "terminal.toggle",
        title: "Terminal: Toggle Visibility",
        shortcut: "Ctrl+`",
        run: (args) =>
          setTerminalVisible((value) =>
            typeof args.visible === "boolean" ? args.visible : !value,
          ),
      },
      {
        id: "terminal.focus",
        title: "Terminal: Focus",
        run: () => {
          setTerminalVisible(true);
          return new Promise<void>((resolve) =>
            setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
                ?.focus();
              resolve();
            }, 60),
          );
        },
      },
      {
        id: "terminal.restart",
        title: "Terminal: Restart Shell",
        enabled: connected,
        run: () =>
          setPrompt({
            title: "Start a new shell?",
            detail:
              "The direct shell is replaced. Your multiplexer owns its persistent sessions.",
            confirm: "Restart terminal",
            action: () => {
              setTerminalNeedsRestart(false);
              setTerminalRestart((value) => value + 1);
            },
          }),
      },
      {
        id: "terminal.start",
        title: "Terminal: Start Shell After Reconnect",
        enabled: connected && terminalNeedsRestart,
        run: () => {
          setTerminalNeedsRestart(false);
          setTerminalRestart((value) => value + 1);
        },
      },
      {
        id: "terminal.setHeight",
        title: "Terminal: Set Height…",
        parameters: {
          height: "Panel height in pixels; constrained to available workspace",
        },
        run: (args) => {
          const apply = (height: number) => {
            if (!Number.isFinite(height))
              throw new Error("Enter a numeric height");
            const available =
              document.querySelector(".workbench")?.clientHeight || innerHeight;
            setTerminalHeight(
              Math.max(100, Math.min(available * 0.65 - 4, height)),
            );
          };
          return args.height === undefined
            ? setPathPrompt({
                title: "Terminal height (px)",
                value: String(terminalHeight),
                action: (value) => apply(Number(value)),
              })
            : apply(args.height);
        },
      },
      {
        id: "terminal.sendText",
        title: "Terminal: Send Text…",
        enabled: connected && !terminalNeedsRestart,
        parameters: {
          text: "Literal terminal input; include a carriage return only when execution is intended",
        },
        run: (args) => {
          const apply = (text: string) => {
            if (typeof text !== "string")
              throw new Error("Terminal input must be text");
            setTerminalVisible(true);
            const detail = { text, accepted: false };
            window.dispatchEvent(
              new CustomEvent("owlet-terminal-input", { detail }),
            );
            if (!detail.accepted)
              throw new Error(
                "The terminal is not ready; wait for its prompt or restart the shell",
              );
          };
          return args.text === undefined
            ? setPathPrompt({
                title: "Send terminal text (without Enter)",
                value: "",
                action: apply,
              })
            : apply(args.text);
        },
      },
      {
        id: "terminal.grow",
        title: "Terminal: Increase Height",
        run: () =>
          setTerminalHeight((value) =>
            Math.min(innerHeight * 0.65, value + 50),
          ),
      },
      {
        id: "terminal.shrink",
        title: "Terminal: Decrease Height",
        run: () => setTerminalHeight((value) => Math.max(100, value - 50)),
      },
      {
        id: "image.fit",
        title: "Image: Fit to View",
        enabled: !!current?.image,
        run: (args) =>
          window.dispatchEvent(
            new CustomEvent("lwr-image", {
              detail: { path: args.path || current!.path, action: "fit" },
            }),
          ),
      },
      {
        id: "image.zoomIn",
        title: "Image: Zoom In",
        enabled: !!current?.image,
        run: (args) =>
          window.dispatchEvent(
            new CustomEvent("lwr-image", {
              detail: { path: args.path || current!.path, action: "in" },
            }),
          ),
      },
      {
        id: "image.zoomOut",
        title: "Image: Zoom Out",
        enabled: !!current?.image,
        run: (args) =>
          window.dispatchEvent(
            new CustomEvent("lwr-image", {
              detail: { path: args.path || current!.path, action: "out" },
            }),
          ),
      },
    ],
    report,
  );
  useEffect(() => {
    const unsubscribe = window.lwr.onRecent(setRecent);
    void window.lwr.recent().then(setRecent).catch(report);
    const stopCommands = window.lwr.onCommand(({ id, args }) =>
      execute(id, args),
    );
    return () => {
      unsubscribe();
      stopCommands();
    };
  }, [commandApi]);
  useEffect(() => {
    const unsubscribe = window.lwr.onConnection((state) => {
      if (state.status === "disconnected") setTerminalNeedsRestart(true);
      setConnection(state);
      if (state.error) report(state.error);
    });
    window.lwr.bootstrap().then(async (config) => {
      setConnection(config.connection);
      try {
        const state = await window.lwr.connect();
        setConnection(state);
        setRoot(config.root ?? state.home ?? "/");
        if (config.root === "") setTerminalVisible(false);
        if (config.file) void openFile(config.file, 1);
      } catch (error) {
        report(error);
      }
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    window.lwr.dirty(dirty);
  }, [dirty]);
  useEffect(() => {
    localStorage.setItem("lwr-vim", String(vimMode));
  }, [vimMode]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      // Respect editor/Vim bindings, particularly Ctrl+R (redo) and Ctrl+W.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setRecentPicker(null);
        setPrompt(null);
        setPathPrompt(null);
        setFolderInput(null);
        setSSHInput(null);
        setComparison(null);
        return;
      }
      const key = event.key.toLowerCase();
      let id: string | undefined;
      if (key === "f1" || (event.ctrlKey && event.shiftKey && key === "p"))
        id = "commands.show";
      else if (key === "f11") id = "window.fullscreen";
      else if ((event.ctrlKey || event.metaKey) && key === "s")
        id = "file.save";
      else if (event.ctrlKey && key === "`") id = "terminal.toggle";
      else if (event.ctrlKey && event.shiftKey && key === "e")
        id = "explorer.toggle";
      else if (event.ctrlKey && key === "r")
        id = event.altKey ? "workspace.openRecent" : "window.reload";
      else if (event.ctrlKey && event.shiftKey && key === "n")
        id = "window.newEmpty";
      else if (event.ctrlKey && key === "w") id = "file.close";
      else if (event.ctrlKey && key === "\\") id = "group.splitRight";
      if (id) {
        event.preventDefault();
        execute(id);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [commandApi]);
  useEffect(() => {
    let polling = false,
      cancelled = false;
    async function poll() {
      if (polling || connectionRef.current.status !== "connected") return;
      const paths = [
        ...new Set(
          groups(layoutRef.current)
            .map((group) => group.active)
            .filter((path): path is string => !!path),
        ),
      ];
      if (!paths.length) return;
      polling = true;
      try {
        const stats = await window.lwr.remote<
          Array<{ path: string; stamp?: string; error?: string }>
        >("stats", { paths });
        for (const stat of stats) {
          const doc = docsRef.current[stat.path];
          if (cancelled || !doc || saving.current.has(stat.path)) continue;
          if (stat.error) {
            patch(stat.path, { missing: true });
            continue;
          }
          if (stat.stamp === doc.stamp) continue;
          if (doc.image) {
            const result = await window.lwr.remote<{
              url: string;
              stamp: string;
            }>("image", { path: stat.path });
            if (!cancelled)
              patch(stat.path, {
                image: result.url,
                stamp: result.stamp,
                missing: false,
              });
          } else {
            const result = await window.lwr.remote<RemoteFile>("read", {
              path: stat.path,
            });
            if (cancelled) continue;
            setDocuments((previous) => {
              const currentDoc = previous[stat.path];
              if (!currentDoc || saving.current.has(stat.path)) return previous;
              if (result.revision === currentDoc.revision)
                return {
                  ...previous,
                  [stat.path]: {
                    ...currentDoc,
                    stamp: result.stamp,
                    conflict: undefined,
                    missing: false,
                  },
                };
              if (currentDoc.text !== currentDoc.saved)
                return {
                  ...previous,
                  [stat.path]: {
                    ...currentDoc,
                    conflict: result,
                    stamp: result.stamp,
                    missing: false,
                  },
                };
              const text = result.text.replace(/\r\n/g, "\n");
              return {
                ...previous,
                [stat.path]: {
                  ...currentDoc,
                  ...result,
                  text,
                  saved: text,
                  conflict: undefined,
                  missing: false,
                  lineEnding: result.text.includes("\r\n") ? "\r\n" : "\n",
                },
              };
            });
          }
        }
      } catch {
        /* Connection state reports outages; transient reads retry next interval. */
      } finally {
        polling = false;
      }
    }
    const timer = setInterval(poll, 2000);
    const focus = () => {
      void poll();
      setRefresh((value) => value + 1);
    };
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  async function reconnect() {
    try {
      const state = await window.lwr.connect();
      setConnection(state);
      if (!root) setRoot(state.home || "/");
      setRefresh((value) => value + 1);
      setMessage(
        "Connected. Unsaved edits are preserved. Restart the terminal when ready.",
      );
    } catch (error) {
      report(error);
    }
  }
  function renderGroup(group: Group): ReactNode {
    const file = group.active ? documents[group.active] : undefined;
    const doc = file
      ? { ...file, mode: viewModes[`${group.id}:${file.path}`] || file.mode }
      : undefined;
    return (
      <section
        className={`editor-group ${activeGroup === group.id ? "active-group" : ""}`}
        data-group={group.id}
        onPointerDown={() => execute("group.focus", { group: group.id })}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          try {
            const { path, source } = JSON.parse(
              event.dataTransfer.getData("application/lwr-tab"),
            );
            execute("group.moveTab", { path, source, destination: group.id });
          } catch {}
        }}
      >
        <div className="tabs-bar">
          <div className="tabs" role="tablist">
            {group.tabs.map((path) => {
              const item = documents[path],
                isDirty = item && item.text !== item.saved;
              return (
                <div
                  key={path}
                  className={`tab ${group.active === path ? "active-tab" : ""}`}
                  role="tab"
                  aria-selected={group.active === path}
                  draggable
                  title={path}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/lwr-tab",
                      JSON.stringify({ path, source: group.id }),
                    );
                  }}
                  onClick={() =>
                    execute("tab.activate", { path, group: group.id })
                  }
                >
                  <FileIcon path={path} />
                  <span>{basename(path)}</span>
                  {isDirty && (
                    <span
                      className="dirty-dot"
                      title="Unsaved changes"
                      aria-label="Unsaved changes"
                    />
                  )}
                  <button
                    className="tab-close"
                    title={`Close ${basename(path)}`}
                    aria-label={`Close ${basename(path)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      execute("file.close", { path, group: group.id });
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="group-actions">
            <button
              title="Split right"
              aria-label="Split right"
              onClick={() => execute("group.splitRight", { group: group.id })}
            >
              <Columns2 size={15} />
            </button>
            <button
              title="Split down"
              aria-label="Split down"
              onClick={() => execute("group.splitDown", { group: group.id })}
            >
              <Rows2 size={15} />
            </button>
            {!group.tabs.length && groups(layout).length > 1 && (
              <button
                title="Close empty group"
                aria-label="Close empty group"
                onClick={() => execute("group.closeEmpty", { group: group.id })}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {doc ? (
          <>
            <div className="document-toolbar">
              <div className="breadcrumbs" title={doc.path}>
                <span>{dirname(doc.path).replace(root, basename(root))}</span>
                <ChevronRight size={12} />
                <strong>{basename(doc.path)}</strong>
              </div>
              <div className="document-actions">
                {isMarkdown(doc.path) && (
                  <div className="mode-switch">
                    {(["source", "preview", "both"] as const).map((mode) => (
                      <button
                        key={mode}
                        className={doc.mode === mode ? "chosen" : ""}
                        title={mode === "both" ? "Source and preview" : mode}
                        aria-label={
                          mode === "both"
                            ? "Source and preview"
                            : mode === "source"
                              ? "Show source"
                              : "Show preview"
                        }
                        onClick={() =>
                          execute(`markdown.${mode}`, {
                            path: doc.path,
                            group: group.id,
                          })
                        }
                      >
                        {mode === "source" ? (
                          <Code2 size={13} />
                        ) : mode === "preview" ? (
                          <BookOpen size={13} />
                        ) : (
                          <Columns2 size={13} />
                        )}
                        <span>
                          {mode === "both"
                            ? "Both"
                            : mode === "source"
                              ? "Source"
                              : "Preview"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!doc.image && (
                  <button
                    title="Save (Ctrl+S)"
                    aria-label="Save file"
                    disabled={
                      busy.has(doc.path) ||
                      doc.text === doc.saved ||
                      connection.status !== "connected"
                    }
                    onClick={() => execute("file.save", { path: doc.path })}
                  >
                    <Save size={15} />
                  </button>
                )}
              </div>
            </div>
            {doc.conflict && (
              <div className="conflict-banner">
                <AlertTriangle size={14} />
                <span>The saved file changed. Your edits are preserved.</span>
                <button
                  onClick={() => execute("file.compare", { path: doc.path })}
                >
                  Compare
                </button>
              </div>
            )}
            {doc.missing && (
              <div className="conflict-banner">
                The file is unavailable. Your buffer is preserved.
              </div>
            )}
            <div className="document-body">
              {doc.image ? (
                <ImageViewer document={doc} onCommand={execute} />
              ) : doc.mode === "both" && isMarkdown(doc.path) ? (
                <SourcePreview
                  ratio={previewRatios[`${group.id}:${doc.path}`] ?? 0.5}
                  onResize={(ratio) =>
                    execute("markdown.resize", {
                      ratio,
                      path: doc.path,
                      group: group.id,
                    })
                  }
                  first={
                    <Editor
                      cacheKey={group.id + ":" + doc.path}
                      path={doc.path}
                      value={doc.text}
                      vimMode={vimMode}
                      onChange={(value) => patch(doc.path, { text: value })}
                      onSave={() =>
                        commandApi.execute("file.save", {
                          path: doc.path,
                        }) as Promise<boolean>
                      }
                      onClose={() =>
                        execute("file.close", {
                          path: doc.path,
                          group: group.id,
                        })
                      }
                    />
                  }
                  second={
                    <Suspense
                      fallback={
                        <div className="loading">Preparing preview…</div>
                      }
                    >
                      <Preview
                        text={doc.text}
                        path={doc.path}
                        root={root}
                        onOpen={(path) =>
                          execute("file.open", { path, group: group.id })
                        }
                        onCommand={(id, args) =>
                          execute(id, { ...args, group: group.id })
                        }
                        refresh={refresh}
                      />
                    </Suspense>
                  }
                />
              ) : doc.mode === "preview" && isMarkdown(doc.path) ? (
                <Suspense
                  fallback={<div className="loading">Preparing preview…</div>}
                >
                  <Preview
                    text={doc.text}
                    path={doc.path}
                    root={root}
                    onOpen={(path) =>
                      execute("file.open", { path, group: group.id })
                    }
                    onCommand={(id, args) =>
                      execute(id, { ...args, group: group.id })
                    }
                    refresh={refresh}
                  />
                </Suspense>
              ) : (
                <Editor
                  cacheKey={group.id + ":" + doc.path}
                  path={doc.path}
                  value={doc.text}
                  vimMode={vimMode}
                  onChange={(value) => patch(doc.path, { text: value })}
                  onSave={() =>
                    commandApi.execute("file.save", {
                      path: doc.path,
                    }) as Promise<boolean>
                  }
                  onClose={() =>
                    execute("file.close", { path: doc.path, group: group.id })
                  }
                />
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <img className="welcome-logo" src={owletLogo} alt="Owlet" />
            <p className="eyebrow">LESS BETWEEN YOU AND YOUR WORK</p>
            <h1>A clearer view.</h1>
            <p>
              Read the work. Follow the reasoning.
              <br />
              {root
                ? "Open a file from your workspace."
                : "Open a folder or return to recent work."}
            </p>
            <div className="welcome-hints">
              <span>
                Save changes <kbd>Ctrl S</kbd>
              </span>
              <span>
                Find in source <kbd>Ctrl F</kbd>
              </span>
              <span>
                Toggle terminal <kbd>Ctrl `</kbd>
              </span>
              <span>
                New project window <code>owlet .</code>
              </span>
            </div>
            <button
              className="text-button"
              onClick={() => execute("window.openFolder")}
            >
              <FolderOpen size={15} />
              {root ? "Open a different folder" : "Open a local folder"}
              <ArrowUpRight size={13} />
            </button>
            <button
              className="text-button"
              onClick={() =>
                execute(local ? "workspace.openSSH" : "workspace.openLocal")
              }
            >
              {local ? <Wifi size={15} /> : <FolderOpen size={15} />}
              {local ? "Connect to Remote" : "Open a local folder"}
            </button>
            <button
              className="text-button"
              onClick={() => execute("workspace.openRecent")}
            >
              <FolderOpen size={15} /> Open Recent
            </button>
          </div>
        )}
      </section>
    );
  }
  function renderLayout(node: Layout): ReactNode {
    return node.kind === "group" ? (
      renderGroup(node.group)
    ) : (
      <Split
        key={node.id}
        axis={node.axis}
        ratio={node.ratio}
        onResize={(ratio) => execute("group.resize", { id: node.id, ratio })}
        first={renderLayout(node.first)}
        second={renderLayout(node.second)}
      />
    );
  }
  const conflictDoc = comparison ? documents[comparison] : undefined;
  return (
    <div className="app-shell" style={appearance.style}>
      <header className="topbar">
        <img className="app-logo" src={owletLogo} alt="Owlet" />
        <button
          className="file-menu-button"
          aria-haspopup="menu"
          aria-label="File"
          onClick={() => execute("menu.file")}
        >
          File
        </button>
        <button
          className="workspace-pill"
          title={root || "Open folder"}
          aria-label="Open workspace folder"
          onClick={() => execute("window.openFolder")}
        >
          <FolderOpen size={14} />
          <strong>
            {root ? basename(root) : connected ? "Open folder" : "connecting"}
          </strong>
        </button>
        <div className="top-actions">
          <button
            aria-label="Choose project color"
            title="Choose project window color"
            onClick={() => execute("project.color.set")}
          >
            <span className="project-swatch" />
          </button>
          <button
            className="palette-button"
            aria-label="Open command palette"
            title="Command palette (Ctrl+Shift+P)"
            onClick={() => execute("commands.show")}
          >
            Commands <kbd>Ctrl ⇧ P</kbd>
          </button>
          <button
            aria-label="Toggle Explorer"
            title="Toggle Explorer"
            className={sidebar ? "enabled" : ""}
            onClick={() => execute("explorer.toggle")}
          >
            <PanelLeft size={17} />
          </button>
          <button
            aria-label="Toggle terminal"
            title="Toggle terminal (Ctrl+`)"
            className={terminalVisible ? "enabled" : ""}
            onClick={() => execute("terminal.toggle")}
          >
            <PanelTop size={17} />
          </button>
          <button
            aria-label="Open folder"
            title="Open folder in new window"
            onClick={() => execute("window.openFolder")}
          >
            <FolderOpen size={17} />
          </button>
        </div>
      </header>
      {recentPicker && (
        <RecentWorkspaces
          entries={recent}
          removing={recentPicker === "remove"}
          onOpen={(id) => execute("workspace.openRecent", { id })}
          onRemove={(id) => execute("workspace.removeRecent", { id })}
          onClose={() => setRecentPicker(null)}
        />
      )}
      <main className="workspace">
        {
          <>
            <div
              className="sidebar-wrap"
              style={{
                width: sidebarWidth,
                display: sidebar ? undefined : "none",
              }}
            >
              <Explorer
                root={root}
                selected={current?.path}
                revision={refresh}
                onOpen={(path) => execute("file.open", { path })}
                onFolder={() => execute("window.openFolder")}
                onRefresh={() => execute("explorer.refresh")}
                onError={report}
                onCommand={execute}
              />
            </div>
            <div
              className="sidebar-handle"
              style={{ display: sidebar ? undefined : "none" }}
              role="separator"
              aria-label="Resize Explorer"
              onPointerDown={(event) =>
                event.currentTarget.setPointerCapture(event.pointerId)
              }
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  execute("explorer.setWidth", { width: event.clientX });
              }}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            />
          </>
        }
        <div className="workbench">
          <div className="editor-area">{renderLayout(layout)}</div>
          <div
            className="terminal-region"
            style={{
              display: terminalVisible ? "flex" : "none",
              height: terminalHeight + 4,
            }}
          >
            <div
              className="terminal-resizer"
              role="separator"
              aria-label="Resize terminal"
              onPointerDown={(event) =>
                event.currentTarget.setPointerCapture(event.pointerId)
              }
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  execute("terminal.setHeight", {
                    height:
                      event.currentTarget.parentElement!.parentElement!.getBoundingClientRect()
                        .bottom -
                      event.clientY -
                      4,
                  });
              }}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            />
            <div className="terminal-panel">
              <div className="terminal-toolbar">
                <div className="terminal-title">
                  <TerminalSquare size={13} />
                  TERMINAL
                  <span>
                    {connection.shell || (local ? "PowerShell" : "Bash")} ·{" "}
                    {connection.target}
                  </span>
                </div>
                <div className="actions">
                  <span className="terminal-tip">
                    New workspace: <code>owlet .</code>
                  </span>
                  <button
                    title="Restart terminal"
                    aria-label="Restart terminal"
                    onClick={() => execute("terminal.restart")}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    title="Hide terminal"
                    aria-label="Hide terminal"
                    onClick={() =>
                      execute("terminal.toggle", { visible: false })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {connection.status === "connected" && !terminalNeedsRestart ? (
                <Suspense
                  fallback={<div className="loading">Opening shell…</div>}
                >
                  <TerminalPane
                    root={root}
                    connection={connection}
                    restart={terminalRestart}
                    onError={report}
                  />
                </Suspense>
              ) : (
                <div className="terminal-disconnected">
                  {connection.status !== "connected" ? (
                    "SSH disconnected. Reconnect to continue."
                  ) : (
                    <>
                      <span>Your old shell ended when SSH disconnected.</span>
                      <button onClick={() => execute("terminal.start")}>
                        Start new shell
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      {message && (
        <div
          className={`toast ${/saved|connected/i.test(message) ? "" : "error-toast"}`}
          role="status"
        >
          <span>{message}</span>
          <button
            aria-label="Dismiss message"
            onClick={() => execute("message.dismiss")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <footer className="statusbar">
        <div>
          <button
            className="remote-launch"
            title="Open a Remote Window (SSH)"
            aria-label="Connect to Remote"
            aria-haspopup="dialog"
            onClick={() => execute("workspace.openSSH")}
          >
            <ChevronsLeftRight size={16} />
          </button>
          <button
            className={`connection-status ${connection.status}`}
            title={`${connection.status} · ${connection.target}\n${root || "Opening workspace"}\nOpen a folder`}
            aria-label={local ? "Local workspace" : "Remote workspace"}
            onClick={() => execute("window.openFolder")}
          >
            {local ? (
              <FolderOpen size={12} />
            ) : connection.status === "connected" ? (
              <Wifi size={12} />
            ) : (
              <WifiOff size={12} />
            )}
            {connection.status === "connected"
              ? local
                ? "Local"
                : `SSH: ${connection.target}`
              : connection.status === "connecting"
                ? "Connecting…"
                : "Disconnected"}
          </button>
          {connection.status === "disconnected" && (
            <button onClick={() => execute("connection.reconnect")}>
              Reconnect
            </button>
          )}
          <span className="status-message">
            {busy.size ? (
              `Working on ${busy.size} file${busy.size > 1 ? "s" : ""}…`
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              <>
                <Check size={11} /> All changes saved
              </>
            )}
          </span>
        </div>
        <div>
          <button
            className={vimMode ? "vim-active" : ""}
            aria-label="Toggle Vim mode"
            aria-pressed={vimMode}
            onClick={() => execute("editor.vim")}
          >
            {vimMode ? "VIM ON" : "VIM OFF"}
          </button>
          <span>UTF-8</span>
          <span>
            {current?.image
              ? "Image"
              : current
                ? isMarkdown(current.path)
                  ? "Markdown"
                  : basename(current.path).split(".").pop()
                : "Ready"}
          </span>
          <span>
            {groups(layout).length} group
            {groups(layout).length === 1 ? "" : "s"}
          </span>
        </div>
      </footer>
      {paletteVisible && (
        <CommandPalette
          commands={commandApi.list()}
          onClose={() => setPaletteVisible(false)}
          onExecute={execute}
        />
      )}
      {appearance.dialog}
      {sshInput && (
        <div className="modal-shade">
          <form
            className="modal"
            role="dialog"
            aria-label="Connect to Remote"
            aria-modal="true"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await commandApi.execute("workspace.openSSH", {
                  target: sshInput.target.trim(),
                  path: sshInput.root.trim() || undefined,
                });
                setSSHInput(null);
              } catch (error) {
                report(error);
              }
            }}
          >
            <Wifi size={24} />
            <h2>Connect to Remote</h2>
            <p>
              Uses your OpenSSH configuration and keys. The connection opens in
              a new window.
            </p>
            <label>
              SSH host
              <input
                autoFocus
                required
                aria-label="SSH host"
                placeholder="my-server or user@host"
                value={sshInput.target}
                onChange={(event) =>
                  setSSHInput({ ...sshInput, target: event.target.value })
                }
              />
            </label>
            <label>
              Remote folder (optional)
              <input
                aria-label="Remote folder"
                placeholder="Home directory"
                value={sshInput.root}
                onChange={(event) =>
                  setSSHInput({ ...sshInput, root: event.target.value })
                }
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setSSHInput(null)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Connect
              </button>
            </div>
          </form>
        </div>
      )}
      {pathPrompt && (
        <div className="modal-shade">
          <form
            className="modal"
            role="dialog"
            aria-label={pathPrompt.title}
            onSubmit={(event) => {
              event.preventDefault();
              const pending = pathPrompt;
              setPathPrompt(null);
              void Promise.resolve()
                .then(() => pending.action(pending.value))
                .catch(report);
            }}
          >
            <h2>{pathPrompt.title}</h2>
            {pathPrompt.multiline ? (
              <textarea
                autoFocus
                aria-label="Buffer text"
                rows={14}
                value={pathPrompt.value}
                onChange={(event) =>
                  setPathPrompt({ ...pathPrompt, value: event.target.value })
                }
              />
            ) : (
              <input
                autoFocus
                aria-label="File path"
                style={{ width: "100%" }}
                value={pathPrompt.value}
                onChange={(event) =>
                  setPathPrompt({ ...pathPrompt, value: event.target.value })
                }
              />
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setPathPrompt(null)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Open
              </button>
            </div>
          </form>
        </div>
      )}
      {prompt && (
        <div className="modal-shade">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={prompt.title}
          >
            <AlertTriangle size={23} />
            <h2>{prompt.title}</h2>
            <p>{prompt.detail}</p>
            <div className="modal-actions">
              <button onClick={() => execute("confirmation.cancel")}>
                Keep editing
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  execute("confirmation.accept", { token: prompt.token })
                }
              >
                {prompt.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
      {folderInput !== null && (
        <div className="modal-shade">
          <form
            className="modal"
            role="dialog"
            aria-label="Open folder"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await commandApi.execute("window.openFolder", {
                  path: folderInput,
                });
                setFolderInput(null);
              } catch (error) {
                report(error);
              }
            }}
          >
            <FolderOpen size={24} />
            <h2>Open a remote folder</h2>
            <p>A new window, using the same SSH connection.</p>
            <label>
              Path on {connection.target}
              <input
                autoFocus
                value={folderInput}
                placeholder="/path/to/project"
                onChange={(event) => setFolderInput(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setFolderInput(null)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Open window
              </button>
            </div>
          </form>
        </div>
      )}
      {conflictDoc?.conflict && (
        <div className="modal-shade">
          <div
            className="modal compare-modal"
            role="dialog"
            aria-label="Compare conflicting changes"
          >
            <h2>Two versions of {basename(conflictDoc.path)}</h2>
            <p>
              The file changed after you opened it. Choose which content to
              keep.
            </p>
            <div className="compare-columns">
              <div>
                <h3>Your unsaved edits</h3>
                <pre>{conflictDoc.text}</pre>
              </div>
              <div>
                <h3>Current saved file</h3>
                <pre>{conflictDoc.conflict.text}</pre>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => execute("conflict.keepEditing")}>
                Keep editing
              </button>
              <button
                onClick={() =>
                  execute("conflict.useRemote", {
                    path: conflictDoc.path,
                    confirmed: true,
                    revision: conflictDoc.conflict!.revision,
                  })
                }
              >
                Use saved version
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  execute("conflict.replace", {
                    path: conflictDoc.path,
                    confirmed: true,
                    revision: conflictDoc.conflict!.revision,
                  })
                }
              >
                Replace file with my edits
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
