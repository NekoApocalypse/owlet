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
  ArrowDownLeft,
  Trash2,
  Pencil,
  Settings as SettingsIcon,
  Search as SearchIcon,
} from "lucide-react";
import Explorer, { FileIcon } from "./Explorer";
import Editor, {
  editorAction,
  vimCommand,
  sourceView,
  sourceClipboard,
  revealSearchMatch,
} from "./Editor";
import CommandPalette, { useCommands, type Command } from "./commands";
import RecentWorkspaces from "./RecentWorkspaces";
import Welcome from "./Welcome";
import TabStrip from "./TabStrip";
import DiagramViewer, { type DiagramView } from "./DiagramViewer";
import SettingsView from "./SettingsView";
import ProjectSearch, { useProjectSearch } from "./ProjectSearch";
import { dropEdge, tileOpenTab, type TileEdge } from "./tiling";
import Uploads, { uploading } from "./Uploads";
import type { Upload } from "./types";
import QuickOpen, { useFileIndex, searchFiles } from "./QuickOpen";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { pdfCommand, type PdfAction } from "./pdfCommands";
import { unsupportedReason } from "./unsupported";
import {
  SETTINGS_PATH,
  defaults,
  definitions,
  editSetting,
  resolveSettings,
  type Settings,
} from "./settings";
import {
  previewFindCommand,
  type PreviewFindAction,
} from "./previewFindCommands";
import type { RecentWorkspace, TerminalSession } from "./types";
import { useProjectAppearance } from "./projectAppearance";
import { useAbout } from "./About";
import {
  basename,
  dirname,
  isImage,
  isPdf,
  isHtml,
  isMarkdown,
  resolvePath,
  type ConnectionState,
  type Document,
  type Group,
  type Layout,
  type RemoteFile,
  type ReloadState,
} from "./types";
import {
  groups,
  mapGroup,
  removeGroup,
  replaceGroup,
  resizeSplit,
} from "./layout";
const Preview = lazy(() => import("./Preview"));
const PdfViewer = lazy(() => import("./PdfViewer"));
const HtmlPreview = lazy(() => import("./HtmlPreview"));
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
  onUnavailable,
}: {
  document: Document;
  onCommand(id: string, args?: Record<string, unknown>): void;
  onUnavailable(reason: string): void;
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
          onError={() =>
            onUnavailable(
              "This image format or file content could not be decoded.",
            )
          }
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
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadsVisible, setUploadsVisible] = useState(false);
  const uploadsRef = useRef<Upload[]>([]);
  useEffect(() => {
    let received = false;
    const update = (items: Upload[]) => {
      const previous = uploadsRef.current;
      if (items.some((item) => !previous.some((old) => old.id === item.id)))
        setUploadsVisible(true);
      if (
        items.some(
          (item) =>
            !uploading(item) &&
            previous.some((old) => old.id === item.id && uploading(old)),
        )
      )
        setRefresh((value) => value + 1);
      uploadsRef.current = items;
      setUploads(items);
    };
    const unsubscribe = window.lwr.onUploads((items) => {
      received = true;
      update(items);
    });
    void window.lwr
      .uploads()
      .then((items) => {
        if (!received) update(items);
      })
      .catch(report);
    return unsubscribe;
  }, []);
  const [diagramView, setDiagramView] = useState<DiagramView | null>(null);
  const nextExpandedView = useRef(0);
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
  const [textMenu, setTextMenu] = useState<{
    x: number;
    y: number;
    group: number;
    path: string;
    kind: "editor" | "preview";
    text: string;
  } | null>(null);
  const [documents, setDocuments] = useState<Record<string, Document>>({});
  const [viewModes, setViewModes] = useState<Record<string, Document["mode"]>>(
    {},
  );
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>(
    {},
  );
  const [previewZoom, setPreviewZoom] = useState(1);
  const [settings, setSettings] = useState<Settings>(defaults);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [settingsFile, setSettingsFile] = useState("");
  const settingsRevision = useRef("");
  const [layout, setLayout] = useState<Layout>({
    kind: "group",
    group: { id: 1, tabs: [] },
  });
  const [activeGroup, setActiveGroup] = useState(1);
  const [sidebar, setSidebar] = useState(true);
  const [tabDrop, setTabDrop] = useState<{
    group: number;
    edge: TileEdge | "center";
  } | null>(null);
  useEffect(() => {
    const clear = () => setTabDrop(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "search">(
    "explorer",
  );
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const sidebarResize = useRef<{
    pointer: number;
    x: number;
    width: number;
  } | null>(null);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [restoringConnection, setRestoringConnection] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>(
    [],
  );
  const [activeTerminal, setActiveTerminal] = useState<string>();
  const [terminalChooser, setTerminalChooser] = useState(false);
  const terminalSerial = useRef(0);
  const initialTerminal = useRef(false);
  const terminalsRef = useRef(terminalSessions);
  terminalsRef.current = terminalSessions;
  const [vimMode, setVimMode] = useState(
    localStorage.getItem("lwr-vim") === "true",
  );
  const legacyVim = useRef(vimMode);
  const [refresh, setRefresh] = useState(0);
  const [explorerActivation, setExplorerActivation] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [indexRevision, setIndexRevision] = useState(0);
  const [quickOpen, setQuickOpen] = useState<string | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{
    path: string;
    root: string;
    cut: boolean;
    revision: string;
    directory: boolean;
  } | null>(null);
  useEffect(() => setFileClipboard(null), [root, connection.target]);
  const [fileMenu, setFileMenu] = useState<{
    path: string;
    directory: boolean;
    x: number;
    y: number;
    group?: number;
  } | null>(null);
  const fileIndex = useFileIndex(
    root,
    connection.status === "connected",
    settings["files.quickOpenMaxDepth"],
    refresh + indexRevision,
    busy.size > 0,
  );
  const [prompt, updatePrompt] = useState<Prompt | null>(null);
  const setPrompt = (value: Prompt | null) =>
    updatePrompt(value ? { ...value, token: crypto.randomUUID() } : null);
  const [folderInput, setFolderInput] = useState<string | null>(null);
  const [sshInput, setSSHInput] = useState<{
    target: string;
    root: string;
  } | null>(null);
  const [comparison, setComparison] = useState<string | null>(null);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [pathPrompt, setPathPrompt] = useState<{
    title: string;
    value: string;
    multiline?: boolean;
    confirm?: string;
    action(path: string): unknown;
  } | null>(null);
  const docsRef = useRef(documents),
    layoutRef = useRef(layout),
    groupRef = useRef(activeGroup),
    connectionRef = useRef(connection);
  const initialRoot = useRef<string | undefined>(undefined);
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
  const selectedTerminal =
    terminalSessions.find((item) => item.id === activeTerminal) ||
    terminalSessions[0];
  const panelTerminals = terminalSessions.filter(
    (item) => item.location === "panel",
  );
  const panelTerminal =
    panelTerminals.find((item) => item.id === activeTerminal) ||
    panelTerminals[0];
  const terminalNeedsRestart = selectedTerminal?.status === "disconnected";
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
    setExplorerActivation((value) => value + 1);
    if (terminalsRef.current.some((item) => item.id === path))
      setActiveTerminal(path);
    setLayout((previous) =>
      mapGroup(previous, group, (value) => ({
        ...value,
        tabs: value.tabs.includes(path) ? value.tabs : [...value.tabs, path],
        active: path,
      })),
    );
    setActiveGroup(group);
  }
  async function readDocument(path: string): Promise<RemoteFile> {
    if (path !== SETTINGS_PATH)
      return window.lwr.remote<RemoteFile>("read", { path });
    const file = await window.lwr.readSettings();
    setSettingsFile(file.path);
    return { ...file, path: SETTINGS_PATH };
  }
  async function openSettings(
    mode: "source" | "preview" = "preview",
    group = groupRef.current,
    background = false,
  ) {
    if (
      !Number.isInteger(group) ||
      !groups(layoutRef.current).some((item) => item.id === group)
    )
      throw new Error("Choose an existing tab group.");
    if (!docsRef.current[SETTINGS_PATH]) {
      const file = await readDocument(SETTINGS_PATH);
      const doc: Document = { ...file, saved: file.text, mode };
      const next = { ...docsRef.current, [SETTINGS_PATH]: doc };
      docsRef.current = next;
      setDocuments(next);
    }
    if (!background) {
      activate(SETTINGS_PATH, group);
      setMode(SETTINGS_PATH, mode, group);
    }
  }
  function applySettings(file: RemoteFile) {
    const values = resolveSettings(file.text);
    settingsRef.current = values;
    setSettings(values);
    setVimMode(values["editor.vimMode"]);
    settingsRevision.current = file.revision;
  }
  async function updateSetting(key: string, value: unknown) {
    if (!docsRef.current[SETTINGS_PATH]) await openSettings();
    const doc = docsRef.current[SETTINGS_PATH];
    patch(SETTINGS_PATH, { text: editSetting(doc.text, key, value) });
  }
  async function openFile(
    path: string,
    group = groupRef.current,
    restoreMode?: Document["mode"],
    ready?: Promise<unknown>,
  ) {
    const background = restoreMode !== undefined;
    if (path === SETTINGS_PATH)
      return openSettings(
        restoreMode === "source" ? "source" : "preview",
        group,
        background,
      );
    if (!groups(layoutRef.current).some((g) => g.id === group))
      throw new Error("Choose an existing tab group.");
    if (docsRef.current[path]) {
      if (docsRef.current[path].unsupported) setSidebar(true);
      if (!background) activate(path, group);
      return opening.current.get(path);
    }
    const placeholder: Document = {
      path,
      text: "",
      saved: "",
      revision: "",
      stamp: "",
      loading: true,
      mode:
        restoreMode ||
        (isMarkdown(path)
          ? (settingsRef.current["markdown.defaultView"] as Document["mode"])
          : isImage(path) || isPdf(path) || isHtml(path)
            ? "preview"
            : "source"),
    };
    docsRef.current = { ...docsRef.current, [path]: placeholder };
    setDocuments(docsRef.current);
    if (!background) activate(path, group);
    let pending = opening.current.get(path);
    if (!pending) {
      pending = (async () => {
        markBusy(path, true);
        try {
          if (ready) await ready;
          let document: Document;
          if (isPdf(path)) {
            const result = await window.lwr.remote<{
              path: string;
              data: string;
              stamp: string;
            }>("pdf", { path });
            document = {
              path: result.path,
              pdf: result.data,
              stamp: result.stamp,
              text: "",
              saved: "",
              revision: "",
              mode: "preview",
            };
          } else if (isImage(path)) {
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
              mode:
                restoreMode ||
                (isMarkdown(path)
                  ? (settingsRef.current[
                      "markdown.defaultView"
                    ] as Document["mode"])
                  : isHtml(path)
                    ? "preview"
                    : "source"),
            };
          }
          return document;
        } catch (error) {
          const reason = unsupportedReason(error);
          if (reason)
            return {
              path,
              text: "",
              saved: "",
              revision: "",
              stamp: "",
              mode: "preview",
              unsupported: reason,
            } as Document;
          if (docsRef.current[path] === placeholder) report(error);
          return {
            ...placeholder,
            loading: false,
            loadError: String(error).replace(/^Error: /, ""),
          };
        } finally {
          if (opening.current.get(path) === pending) {
            markBusy(path, false);
            opening.current.delete(path);
          }
        }
      })();
      opening.current.set(path, pending);
    }
    const document = await pending;
    // Completion fills only this pending tab. Never steal focus or resurrect a
    // closed tab; a later reopen owns a different placeholder/request.
    if (document && docsRef.current[path] === placeholder) {
      docsRef.current = { ...docsRef.current, [path]: document };
      setDocuments(docsRef.current);
      if (
        document.unsupported &&
        groups(layoutRef.current).find((g) => g.id === groupRef.current)
          ?.active === path
      ) {
        setSidebar(true);
        setExplorerActivation((value) => value + 1);
      }
    }
  }
  function dismissUnsupported(keepFocused = false) {
    let next = layoutRef.current;
    const removed = new Set<string>();
    for (const group of groups(next)) {
      const tabs = group.tabs.filter((path) => {
        const remove =
          !!docsRef.current[path]?.unsupported &&
          !(
            keepFocused &&
            group.id === groupRef.current &&
            group.active === path
          );
        if (remove) removed.add(path);
        return !remove;
      });
      if (tabs.length !== group.tabs.length) {
        next = mapGroup(next, group.id, (g) => ({
          ...g,
          tabs,
          active: g.active && tabs.includes(g.active) ? g.active : tabs.at(-1),
        }));
        if (!tabs.length && groups(next).length > 1)
          next = removeGroup(next, group.id)!;
      }
    }
    if (!removed.size) return;
    layoutRef.current = next;
    setLayout(next);
    if (!groups(next).some((g) => g.id === groupRef.current))
      setActiveGroup(groups(next)[0].id);
    const retained = new Set(groups(next).flatMap((g) => g.tabs));
    setDocuments((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([path]) => !removed.has(path) || retained.has(path),
        ),
      ),
    );
  }
  useEffect(() => {
    dismissUnsupported(true);
  }, [layout, activeGroup, documents]);
  function unsupportedPreview(source: Document, reason: string) {
    const current = docsRef.current[source.path];
    if (
      !current ||
      current.pdf !== source.pdf ||
      current.image !== source.image ||
      current.text !== current.saved
    )
      return;
    patch(source.path, {
      unsupported: reason,
      pdf: undefined,
      image: undefined,
    });
    if (
      groups(layoutRef.current).find((g) => g.id === groupRef.current)
        ?.active === source.path
    ) {
      setSidebar(true);
      setExplorerActivation((value) => value + 1);
    }
  }
  const beneath = (path: string, parent: string) =>
    path === parent || path.startsWith(parent.replace(/\/$/, "") + "/");
  function checkFileBuffers(path: string, destination?: string) {
    for (const doc of Object.values(docsRef.current)) {
      if (
        beneath(doc.path, path) &&
        (doc.text !== doc.saved || saving.current.has(doc.path))
      )
        throw new Error(
          "Save or discard edits in the selected item before moving or deleting it.",
        );
      if (
        destination &&
        beneath(doc.path, destination) &&
        !beneath(doc.path, path)
      )
        throw new Error(
          "Close tabs at the destination before moving this item.",
        );
    }
  }
  function updateOpenPaths(source: string, destination?: string) {
    // Typing can continue while a remote operation is in flight. If deletion
    // finished after new edits arrived, keep that buffer as a missing file.
    const keep = new Set(
      Object.values(docsRef.current)
        .filter(
          (doc) =>
            !destination && beneath(doc.path, source) && doc.text !== doc.saved,
        )
        .map((doc) => doc.path),
    );
    const moved = (path: string) =>
      beneath(path, source) && !keep.has(path)
        ? destination
          ? destination + path.slice(source.length)
          : undefined
        : path;
    const next: Record<string, Document> = {};
    for (const doc of Object.values(docsRef.current)) {
      const path = moved(doc.path);
      if (path)
        next[path] = {
          ...doc,
          path,
          missing: keep.has(doc.path) || doc.missing,
          conflict: doc.conflict ? { ...doc.conflict, path } : undefined,
        };
    }
    docsRef.current = next;
    setDocuments(next);
    setLayout((previous) =>
      groups(previous).reduce(
        (result, group) =>
          mapGroup(result, group.id, (current) => {
            const tabs = current.tabs
              .map(moved)
              .filter((path): path is string => !!path);
            return {
              ...current,
              tabs,
              active: current.active
                ? moved(current.active) || tabs[0]
                : tabs[0],
            };
          }),
        previous,
      ),
    );
    setViewModes((previous) =>
      Object.fromEntries(
        Object.entries(previous).flatMap(([key, mode]) => {
          const at = key.indexOf(":"),
            path = moved(key.slice(at + 1));
          return path ? [[key.slice(0, at + 1) + path, mode]] : [];
        }),
      ),
    );
    if (comparison && beneath(comparison, source)) setComparison(null);
  }
  async function createItem(directory: string, name: string, folder: boolean) {
    markBusy("file-operation", true);
    try {
      const result = await window.lwr.remote<{ path: string }>("fs-operation", {
        op: folder ? "create-folder" : "create-file",
        root,
        directory,
        name,
      });
      setRefresh((value) => value + 1);
      if (!folder) await openFile(result.path);
      setMessage(`Created ${basename(result.path)}`);
      return result;
    } finally {
      markBusy("file-operation", false);
    }
  }
  async function proposeFileChange(
    op: "delete" | "move",
    path: string,
    destination?: string,
  ) {
    if (!path || path === SETTINGS_PATH || path === root)
      throw new Error("Choose a file or folder inside this workspace.");
    checkFileBuffers(path, destination);
    const metadata = await window.lwr.remote<{
      revision: string;
      directory: boolean;
    }>("fs-operation", { op: "inspect", root, path });
    setPrompt({
      title:
        op === "delete"
          ? `Delete ${basename(path)} permanently?`
          : `Move ${basename(path)}?`,
      detail:
        op === "delete"
          ? `${path}${metadata.directory ? " and everything inside it" : ""} will be permanently deleted. This does not use the Recycle Bin.`
          : `${path}\n→ ${destination}\nExisting files will not be overwritten.`,
      confirm: op === "delete" ? "Delete permanently" : "Move",
      action: async () => {
        checkFileBuffers(path, destination);
        const locked = Object.keys(docsRef.current).filter((item) =>
          beneath(item, path),
        );
        locked.forEach((item) => saving.current.add(item));
        markBusy("file-operation", true);
        try {
          const result = await window.lwr.remote("fs-operation", {
            op,
            root,
            path,
            destination,
            revision: metadata.revision,
          });
          updateOpenPaths(path, destination);
          setFileClipboard((value) =>
            value?.cut && value.path === path ? null : value,
          );
          setRefresh((value) => value + 1);
          setMessage(
            `${op === "delete" ? "Deleted" : "Moved"} ${basename(path)}`,
          );
          return result;
        } finally {
          locked.forEach((item) => saving.current.delete(item));
          markBusy("file-operation", false);
        }
      },
    });
    return { confirmationRequired: true };
  }
  async function copyFileReference(path: string, cut: boolean) {
    if (!path || path === SETTINGS_PATH || path === root)
      throw new Error("Choose a file or folder inside this workspace.");
    checkFileBuffers(path);
    const metadata = await window.lwr.remote<{
      revision: string;
      directory: boolean;
    }>("fs-operation", { op: "inspect", path });
    setFileClipboard({ path, root, cut, ...metadata });
    setMessage(
      `${cut ? "Cut" : "Copied"} ${basename(path)} — choose a folder and Paste`,
    );
  }
  async function pasteFile(directory: string) {
    const clipboard = fileClipboard;
    if (!clipboard || clipboard.root !== root)
      throw new Error("Copy or cut an item in this Owlet window first.");
    checkFileBuffers(clipboard.path);
    const metadata = await window.lwr.remote<{ revision: string }>(
      "fs-operation",
      { op: "inspect", path: clipboard.path },
    );
    if (metadata.revision !== clipboard.revision)
      throw new Error(
        "The copied item changed. Copy or cut it again before pasting.",
      );
    let destination = resolvePath(directory, basename(clipboard.path));
    if (clipboard.cut && destination === clipboard.path) return;
    if (!clipboard.cut && dirname(clipboard.path) === directory) {
      const name = basename(clipboard.path),
        dot = clipboard.directory ? -1 : name.lastIndexOf("."),
        stem = dot > 0 ? name.slice(0, dot) : name,
        extension = dot > 0 ? name.slice(dot) : "";
      for (let i = 1; i <= 1000; i++) {
        destination = resolvePath(
          directory,
          `${stem} copy${i === 1 ? "" : ` ${i}`}${extension}`,
        );
        try {
          await window.lwr.remote("stat", { path: destination });
        } catch (error) {
          if (/ENOENT|\[Errno 2\]|No such file/i.test(String(error))) break;
          throw error;
        }
        if (i === 1000) throw new Error("Choose another destination folder.");
      }
    }
    if (clipboard.cut)
      return proposeFileChange("move", clipboard.path, destination);
    markBusy("file-operation", true);
    setMessage(`Copying ${basename(clipboard.path)}…`);
    try {
      const result = await window.lwr.remote("fs-operation", {
        op: "copy",
        path: clipboard.path,
        destination,
        revision: clipboard.revision,
      });
      setRefresh((value) => value + 1);
      setMessage(`Copied ${basename(clipboard.path)}`);
      return result;
    } finally {
      markBusy("file-operation", false);
    }
  }
  async function saveFile(
    path: string,
    replacementRevision?: string,
  ): Promise<boolean> {
    const doc = docsRef.current[path];
    if (
      !doc ||
      doc.image ||
      doc.pdf ||
      doc.unsupported ||
      doc.loading ||
      doc.loadError
    )
      return false;
    if (doc.text === doc.saved && !replacementRevision) return true;
    if (saving.current.has(path)) return false;
    saving.current.add(path);
    markBusy(path, true);
    try {
      const text =
        doc.lineEnding === "\r\n" ? doc.text.replace(/\n/g, "\r\n") : doc.text;
      const result =
        path === SETTINGS_PATH
          ? await window.lwr.saveSettings({
              text,
              revision: replacementRevision || doc.revision,
            })
          : await window.lwr.remote<{
              revision: string;
              stamp: string;
            }>("save", {
              path,
              text,
              revision: replacementRevision || doc.revision,
            });
      if (path === SETTINGS_PATH) applySettings({ ...doc, ...result, text });
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
          const remote = await readDocument(path);
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
  async function reloadFile(path: string, discard = false): Promise<boolean> {
    if (typeof discard !== "boolean")
      throw new Error("discard must be true or false.");
    const before = docsRef.current[path];
    if (
      !before ||
      before.image ||
      before.pdf ||
      before.unsupported ||
      before.loading ||
      before.loadError
    )
      throw new Error("Open a text file first.");
    if (before.text !== before.saved && !discard)
      throw new Error(
        "Unsaved changes. Save first, or use :e! to discard and reload.",
      );
    if (saving.current.has(path))
      throw new Error("A save or reload is already in progress.");
    saving.current.add(path);
    markBusy(path, true);
    try {
      const file = await readDocument(path);
      const latest = docsRef.current[path];
      if (
        !latest ||
        latest.text !== before.text ||
        latest.revision !== before.revision
      )
        throw new Error(
          "The buffer changed while reloading. Your newer edits were kept; retry when ready.",
        );
      const text = file.text.replace(/\r\n/g, "\n");
      patch(path, {
        ...file,
        text,
        saved: text,
        conflict: undefined,
        missing: false,
        lineEnding: file.text.includes("\r\n") ? "\r\n" : "\n",
      });
      if (comparison === path) setComparison(null);
      return true;
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
    layoutRef.current = result;
    setLayout(result);
    if (!groups(result).some((group) => group.id === activeGroup))
      setActiveGroup(groups(result)[0].id);
    if (!groups(result).some((group) => group.tabs.includes(path))) {
      opening.current.delete(path);
      markBusy(path, false);
      const updated = { ...docsRef.current };
      delete updated[path];
      docsRef.current = updated;
      setDocuments(updated);
    } else if (discard)
      patch(path, { text: docsRef.current[path]?.saved || "" });
  }
  function closeFile(
    path: string,
    groupId: number,
    resume?: () => void,
  ): boolean {
    if (terminalsRef.current.some((item) => item.id === path)) {
      return closeTerminal(path, resume);
    }
    if (saving.current.has(path))
      throw new Error("Wait for this file to finish saving before closing it");
    const doc = docsRef.current[path];
    const occurrences = groups(layoutRef.current).filter((group) =>
      group.tabs.includes(path),
    ).length;
    if (doc && doc.text !== doc.saved && occurrences <= 1) {
      setPrompt({
        title: `Discard changes to ${basename(path)}?`,
        detail: "The file has not been updated with these edits.",
        confirm: "Discard changes",
        action: () => {
          if (saving.current.has(path))
            throw new Error(
              "Wait for this file to finish saving before closing it",
            );
          performClose(path, groupId);
          resume?.();
        },
      });
      return false;
    }
    performClose(path, groupId);
    return true;
  }
  function closeOthers(path: string, groupId: number) {
    const target = groups(layoutRef.current).find((g) => g.id === groupId);
    if (!target || !target.tabs.includes(path))
      throw new Error("Choose a tab in this group");
    // Snapshot the targets: tabs opened while a confirmation is pending survive.
    const remaining = target.tabs.filter((tab) => tab !== path);
    const next = () => {
      while (remaining.length) {
        const group = groups(layoutRef.current).find((g) => g.id === groupId);
        if (!group?.tabs.includes(path)) return;
        const other = remaining.shift()!;
        if (group.tabs.includes(other) && !closeFile(other, groupId, next))
          return;
      }
    };
    next();
  }
  function reloadWindow() {
    if (saving.current.size)
      throw new Error("Wait for saves to finish before reloading");
    const restoredLayout = groups(layoutRef.current).reduce(
      (next, group) =>
        mapGroup(next, group.id, (g) => {
          const tabs = g.tabs.filter(
            (path) => !docsRef.current[path]?.unsupported,
          );
          return {
            ...g,
            tabs,
            active: g.active && tabs.includes(g.active) ? g.active : tabs[0],
          };
        }),
      layoutRef.current,
    );
    return window.lwr.reload({
      version: 1,
      layout: restoredLayout,
      activeGroup: groupRef.current,
      modes: Object.fromEntries(
        Object.values(docsRef.current).map((doc) => [doc.path, doc.mode]),
      ),
      viewModes,
      previewRatios,
      previewZoom,
      sidebar,
      sidebarWidth,
      terminalVisible,
      terminalHeight,
      terminals: terminalsRef.current.map(({ id, name, path, location }) => ({
        id,
        name,
        path,
        location,
      })),
      activeTerminal,
      terminalSerial: terminalSerial.current,
    });
  }
  function restoreWindow(state: ReloadState, ready: Promise<unknown>) {
    layoutRef.current = state.layout;
    groupRef.current = state.activeGroup;
    setLayout(state.layout);
    setActiveGroup(state.activeGroup);
    setViewModes(state.viewModes);
    setPreviewRatios(state.previewRatios);
    setPreviewZoom(state.previewZoom);
    setSidebar(state.sidebar);
    setSidebarWidth(state.sidebarWidth);
    setTerminalHeight(state.terminalHeight);
    setTerminalVisible(state.terminalVisible);
    terminalSerial.current = state.terminalSerial;
    const terminals = state.terminals.map((item) => ({
      ...item,
      status: "starting" as const,
      restart: 0,
    }));
    terminalsRef.current = terminals;
    setTerminalSessions(terminals);
    setActiveTerminal(state.activeTerminal);
    const walk = (node: Layout) => {
      if (node.kind === "group")
        nextGroup = Math.max(nextGroup, node.group.id + 1);
      else {
        nextSplit = Math.max(nextSplit, node.id + 1);
        walk(node.first);
        walk(node.second);
      }
    };
    walk(state.layout);
    const files = new Map<string, number>();
    // Active documents start loading first. Every openFile call creates its
    // loading tab synchronously; completions do not change focus or tab order.
    const ordered = groups(state.layout).sort(
      (a, b) =>
        Number(b.id === state.activeGroup) - Number(a.id === state.activeGroup),
    );
    for (const group of ordered)
      for (const path of [group.active, ...group.tabs])
        if (path && !files.has(path) && !terminals.some((t) => t.id === path))
          files.set(path, group.id);
    for (const [path, group] of files)
      void openFile(
        path,
        group,
        state.modes[path] || (path === SETTINGS_PATH ? "preview" : "source"),
        ready,
      ).catch(report);
  }
  function splitGroup(group: Group, axis: "row" | "column", before = false) {
    const id = nextGroup++;
    const terminal = terminalsRef.current.some(
      (item) => item.id === group.active,
    );
    if (group.active)
      setViewModes((previous) => ({
        ...previous,
        [`${id}:${group.active}`]:
          previous[`${group.id}:${group.active}`] ||
          documents[group.active!]?.mode ||
          "source",
      }));
    setLayout((previous) => {
      const split: Layout = {
        kind: "split",
        id: nextSplit++,
        axis,
        ratio: 0.5,
        first: {
          kind: "group",
          group: terminal
            ? {
                ...group,
                tabs: group.tabs.filter((item) => item !== group.active),
                active: group.tabs.find((item) => item !== group.active),
              }
            : group,
        },
        second: {
          kind: "group",
          group: {
            id,
            tabs: group.active ? [group.active] : [],
            active: group.active,
          },
        },
      };
      if (before) [split.first, split.second] = [split.second, split.first];
      return replaceGroup(previous, group.id, split);
    });
    setActiveGroup(id);
  }
  function moveTab(path: string, source: number, destination: number) {
    const all = groups(layoutRef.current);
    if (
      !all.some((group) => group.id === source && group.tabs.includes(path)) ||
      !all.some((group) => group.id === destination)
    )
      throw new Error("Choose an open tab and destination group");
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
  const projectSearch = useProjectSearch(root, connected, settings);
  function showSearch(args: Record<string, any> = {}) {
    setSidebar(true);
    setSidebarMode("search");
    projectSearch.configure(args);
    requestAnimationFrame(() => projectSearch.input.current?.focus());
  }
  const local = connection.kind === "local";
  function terminalById(id = selectedTerminal?.id) {
    const item = terminalsRef.current.find((item) => item.id === id);
    if (!item) throw new Error("Choose an existing terminal");
    return item;
  }
  function updateTerminal(id: string, change: Partial<TerminalSession>) {
    setTerminalSessions((items) =>
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  }
  function createTerminal() {
    const id = `owlet-terminal:${crypto.randomUUID()}`;
    const item: TerminalSession = {
      id,
      name: `${connection.shell || (local ? "PowerShell" : "Bash")} ${++terminalSerial.current}`,
      path: root,
      location: "panel",
      status: "starting",
      restart: 0,
    };
    setTerminalSessions((items) => [...items, item]);
    setActiveTerminal(id);
    setTerminalVisible(true);
    return id;
  }
  function detachTerminalTab(id: string) {
    const detach = (previous: Layout) => {
      let next = previous;
      for (const group of groups(previous))
        next = mapGroup(next, group.id, (item) => {
          const tabs = item.tabs.filter((tab) => tab !== id);
          return {
            ...item,
            tabs,
            active: item.active === id ? tabs[0] : item.active,
          };
        });
      return next;
    };
    const next = detach(layoutRef.current);
    layoutRef.current = next;
    setLayout(next);
  }
  function closeTerminal(id?: string, resume?: () => void): boolean {
    const item = terminalById(id);
    const close = () => {
      detachTerminalTab(item.id);
      setTerminalSessions((items) =>
        items.filter((entry) => entry.id !== item.id),
      );
    };
    if (["starting", "running"].includes(item.status)) {
      setPrompt({
        title: `Kill ${item.name}?`,
        detail:
          "This ends this shell and any agent or process running in it. Other terminals stay open.",
        confirm: "Kill terminal",
        action: () => {
          close();
          resume?.();
        },
      });
      return false;
    }
    close();
    return true;
  }
  function revealTerminal(item: TerminalSession) {
    setActiveTerminal(item.id);
    if (item.location === "panel") setTerminalVisible(true);
    else {
      const group = groups(layoutRef.current).find((group) =>
        group.tabs.includes(item.id),
      );
      if (group) activate(item.id, group.id);
    }
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("owlet-terminal-focus", { detail: { id: item.id } }),
        );
        resolve();
      }, 60),
    );
  }
  useEffect(() => {
    if (root && connected && !initialTerminal.current) {
      initialTerminal.current = true;
      createTerminal();
    }
  }, [root, connected]);
  const about = useAbout(report);
  const appearance = useProjectAppearance(
    root,
    connection.target,
    connected,
    report,
  );
  const {
    api: commandApi,
    execute,
    executePalette,
    history: commandHistory,
  } = useCommands(
    [
      ...appearance.commands,
      ...about.commands,
      {
        id: "search.open",
        title: "Search: Find in Project",
        shortcut: "Ctrl+Shift+F",
        keywords: ["Find in Files", "Full text", "Workspace search"],
        parameters: {
          query: "Optional literal query",
          directory:
            "Optional search folder, relative to workspace or absolute",
        },
        run: (args) => {
          showSearch(args);
          if (args.query) return projectSearch.run(args);
        },
      },
      {
        id: "search.run",
        title: "Search: Run or Rerun Project Search",
        enabled: connected && !!root,
        parameters: {
          query: "Literal single-line query; defaults to search field",
          directory: "Folder within workspace",
          include: "Comma-separated include globs",
          exclude:
            "Comma-separated exclude globs; empty disables configured exclusions",
          caseSensitive: "Boolean",
          wholeWord: "Boolean",
          includeHidden: "Boolean",
          includeIgnored: "Boolean",
          maxResults: "1–10000 matching lines",
          timeoutSeconds: "1–120 seconds",
          maxResultMB: "1–8 MiB",
          maxFileSizeMB: "1–32 MiB",
          maxDepth: "0 for all depths; otherwise 1–100",
          threads: "1–4 workers",
        },
        run: (args) => {
          setSidebar(true);
          setSidebarMode("search");
          return projectSearch.run(args);
        },
      },
      {
        id: "search.stop",
        title: "Search: Stop Project Search",
        run: () => projectSearch.stop(),
      },
      {
        id: "search.clear",
        title: "Search: Clear Project Search",
        run: () => projectSearch.clear(),
      },
      {
        id: "search.more",
        title: "Search: Rerun with Higher Limits",
        enabled: connected && !!projectSearch.state.request,
        run: () => projectSearch.more(),
      },
      {
        id: "search.scope",
        title: "Search: Find in Folder…",
        parameters: {
          directory:
            "Folder within workspace; omission focuses the scope field",
        },
        run: (args) => {
          showSearch(args);
          if (args.directory !== undefined) {
            if (projectSearch.form.query) return projectSearch.run(args);
          } else
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLInputElement>(
                  'input[aria-label="Search folder"]',
                )
                ?.focus(),
            );
        },
      },
      {
        id: "search.toggleFile",
        title: "Search: Expand or Collapse File Results",
        parameters: { path: "Result file path; defaults to first result file" },
        enabled: projectSearch.state.matches.length > 0,
        run: (args) => {
          const path = args.path ?? projectSearch.state.matches[0]?.path;
          if (!projectSearch.state.matches.some((item) => item.path === path))
            throw Error("Choose a file from the search results.");
          projectSearch.toggleFile(path);
        },
      },
      {
        id: "search.inspect",
        title: "Search: Inspect Project Search",
        parameters: { readOnly: "True returns state; otherwise copies JSON" },
        run: (args) => {
          const result = { ...projectSearch.state, form: projectSearch.form };
          if (!args.readOnly)
            void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        id: "search.openResult",
        title: "Search: Open Matching Line",
        parameters: {
          index: "Zero-based matching-line index; defaults to first result",
        },
        enabled: projectSearch.state.matches.length > 0,
        run: async (args) => {
          const index = args.index ?? 0;
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            !projectSearch.state.matches[index]
          )
            throw Error("Choose a valid search result.");
          const match = projectSearch.state.matches[index],
            group = groupRef.current;
          await openFile(match.path, group);
          if (
            groups(layoutRef.current).find((item) => item.id === group)
              ?.active !== match.path
          )
            return;
          const doc = docsRef.current[match.path];
          if (!doc || doc.loadError || doc.unsupported)
            throw Error(
              doc?.loadError ||
                doc?.unsupported ||
                "Unable to open this result.",
            );
          setMode(match.path, "source", group);
          for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 16));
            if (
              groups(layoutRef.current).find((item) => item.id === group)
                ?.active !== match.path
            )
              return;
            const result = revealSearchMatch(
              `${group}:${match.path}`,
              match.line,
              match.column,
              match.match,
            );
            if (result === "ready") return true;
            if (result === "stale") {
              setMessage(
                "This file changed since the search. Rerun to update the matching line.",
              );
              return false;
            }
          }
          throw Error(
            "The source editor is not ready. Try opening the result again.",
          );
        },
      },
      {
        id: "explorer.show",
        title: "View: Show Explorer",
        run: () => {
          setSidebar(true);
          setSidebarMode("explorer");
        },
      },
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
        id: "commands.recent",
        title: "Preferences: Copy Recent Commands",
        keywords: ["history", "command palette"],
        parameters: {
          readOnly: "true returns the command IDs without copying",
        },
        run: async (args) => {
          const history = await window.lwr.commandHistory();
          if (!args.readOnly) {
            await navigator.clipboard.writeText(
              JSON.stringify(history, null, 2),
            );
            setMessage("Copied recent commands");
          }
          return history;
        },
      },
      {
        id: "commands.clearRecent",
        title: "Preferences: Clear Recent Commands",
        keywords: ["history", "command palette"],
        run: () => window.lwr.clearCommandHistory(),
      },
      {
        id: "diagram.open",
        title: "Markdown: Expand Mermaid Diagram…",
        keywords: ["Fullscreen diagram", "Zoom Mermaid"],
        parameters: {
          index: "Zero-based diagram index; defaults to first rendered diagram",
          group: "Optional preview group ID",
        },
        enabled: groups(layout).some(
          (group) => !!group.active && isMarkdown(group.active),
        ),
        run: (args) => {
          const group = args.group ?? currentGroup.id;
          const index = args.index ?? 0;
          if (!Number.isInteger(index) || index < 0 || !Number.isInteger(group))
            throw new Error("Choose a valid diagram and group");
          const source = document
            .querySelectorAll<HTMLElement>(`[data-group="${group}"] .diagram`)
            [index]?.querySelector<SVGSVGElement>("svg");
          if (!source)
            throw new Error(
              "Open the Markdown preview and wait for its diagrams to render",
            );
          const width =
            source.viewBox.baseVal.width ||
            source.getBoundingClientRect().width;
          const height =
            source.viewBox.baseVal.height ||
            source.getBoundingClientRect().height;
          if (!width || !height)
            throw new Error("This diagram has no drawable area");
          const file = groups(layoutRef.current).find(
            (item) => item.id === group,
          )?.active;
          const svg = source.cloneNode(true) as SVGSVGElement;
          svg.setAttribute("width", String(width));
          svg.setAttribute("height", String(height));
          svg.style.width = `${width}px`;
          svg.style.height = `${height}px`;
          svg.style.maxWidth = "none";
          setDiagramView({
            id: ++nextExpandedView.current,
            kind: "diagram",
            svg: svg.outerHTML,
            title: `${basename(file || "Markdown")} · Diagram ${index + 1}`,
            width,
            height,
            scale: 1,
            x: 0,
            y: 0,
          });
        },
      },
      {
        id: "preview.image.open",
        title: "Markdown: Expand Image…",
        keywords: ["Fullscreen image", "Zoom image", "Picture"],
        parameters: {
          index:
            "Zero-based image index; defaults to first image in the preview",
          group: "Optional preview group ID",
        },
        enabled: groups(layout).some(
          (group) => !!group.active && isMarkdown(group.active),
        ),
        run: (args) => {
          const group = args.group ?? currentGroup.id;
          const index = args.index ?? 0;
          if (!Number.isInteger(index) || index < 0 || !Number.isInteger(group))
            throw new Error("Choose a valid image and group");
          const source = document.querySelectorAll<HTMLImageElement>(
            `[data-group="${group}"] .markdown-preview .remote-image img`,
          )[index];
          if (
            !source?.complete ||
            !source.naturalWidth ||
            !source.naturalHeight
          )
            throw new Error(
              "Open the Markdown preview and wait for its image to load",
            );
          const src = source.currentSrc || source.src;
          if (!/^data:image\//i.test(src))
            throw new Error("This image is not available for expansion");
          const file = groups(layoutRef.current).find(
            (item) => item.id === group,
          )?.active;
          setDiagramView({
            id: ++nextExpandedView.current,
            kind: "image",
            src,
            alt: source.alt,
            title: `${basename(file || "Markdown")} · ${source.alt || `Image ${index + 1}`}`,
            width: source.naturalWidth,
            height: source.naturalHeight,
            scale: 1,
            x: 0,
            y: 0,
          });
        },
      },
      ...(["diagram", "preview.image"] as const).flatMap(
        (prefix): Command[] => {
          const label = prefix === "diagram" ? "Diagram" : "Preview Image";
          const enabled =
            diagramView?.kind === (prefix === "diagram" ? "diagram" : "image");
          return [
            {
              id: `${prefix}.close`,
              title: `${label}: Close Expanded View`,
              enabled,
              run: () => setDiagramView(null),
            },
            ...(["fit", "actualSize"] as const).map((action) => ({
              id: `${prefix}.${action}`,
              title:
                action === "fit"
                  ? `${label}: Fit to View`
                  : `${label}: Actual Size (100%)`,
              enabled,
              run: () => {
                const rect = document
                  .querySelector(".diagram-canvas")
                  ?.getBoundingClientRect();
                if (!rect) return;
                setDiagramView((value) => {
                  if (!value) return value;
                  const scale =
                    action === "fit"
                      ? Math.max(
                          0.02,
                          Math.min(
                            (rect.width - 48) / value.width,
                            (rect.height - 48) / value.height,
                            16,
                          ),
                        )
                      : 1;
                  return {
                    ...value,
                    scale,
                    x: (rect.width - value.width * scale) / 2,
                    y: (rect.height - value.height * scale) / 2,
                  };
                });
              },
            })),
            ...(["zoomIn", "zoomOut"] as const).map((action) => ({
              id: `${prefix}.${action}`,
              title:
                action === "zoomIn"
                  ? `${label}: Zoom In`
                  : `${label}: Zoom Out`,
              enabled,
              run: () =>
                commandApi.execute(`${prefix}.zoom`, {
                  factor: action === "zoomIn" ? 1.25 : 0.8,
                }),
            })),
            {
              id: `${prefix}.zoom`,
              title: `${label}: Set Zoom…`,
              enabled,
              parameters: {
                scale: "Absolute scale (1 = 100%), clamped to 0.02–16",
                factor: "Optional relative multiplier instead of scale",
                x: "Optional anchor x in canvas pixels",
                y: "Optional anchor y in canvas pixels",
              },
              run: (args) => {
                const apply = (scale?: number, factor?: number) => {
                  if (
                    (scale !== undefined &&
                      (!Number.isFinite(scale) || scale <= 0)) ||
                    (factor !== undefined &&
                      (!Number.isFinite(factor) || factor <= 0))
                  )
                    throw new Error("Choose a positive zoom");
                  const rect = document
                    .querySelector(".diagram-canvas")
                    ?.getBoundingClientRect();
                  if (!rect) return;
                  const x = args.x ?? rect.width / 2,
                    y = args.y ?? rect.height / 2;
                  if (!Number.isFinite(x) || !Number.isFinite(y))
                    throw new Error("Invalid zoom anchor");
                  setDiagramView((value) => {
                    if (!value) return value;
                    const next = Math.max(
                      0.02,
                      Math.min(16, scale ?? value.scale * (factor ?? 1)),
                    );
                    return {
                      ...value,
                      scale: next,
                      x: x - ((x - value.x) * next) / value.scale,
                      y: y - ((y - value.y) * next) / value.scale,
                    };
                  });
                };
                return args.scale === undefined && args.factor === undefined
                  ? setPathPrompt({
                      title: `${label} zoom (%)`,
                      value: String(Math.round(diagramView!.scale * 100)),
                      action: (value) => apply(Number(value) / 100),
                    })
                  : apply(args.scale, args.factor);
              },
            },
            {
              id: `${prefix}.pan`,
              title: `${label}: Pan…`,
              enabled,
              parameters: {
                dx: "Horizontal movement in pixels",
                dy: "Vertical movement in pixels",
              },
              run: (args) => {
                const apply = (dx: number, dy: number) => {
                  if (!Number.isFinite(dx) || !Number.isFinite(dy))
                    throw new Error("Enter numeric x, y movement");
                  setDiagramView(
                    (value) =>
                      value && { ...value, x: value.x + dx, y: value.y + dy },
                  );
                };
                return args.dx === undefined && args.dy === undefined
                  ? setPathPrompt({
                      title: "Pan by x, y pixels",
                      value: "100, 0",
                      action: (value) => {
                        const [x, y] = value.split(",").map(Number);
                        apply(x, y);
                      },
                    })
                  : apply(args.dx ?? 0, args.dy ?? 0);
              },
            },
          ];
        },
      ),
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
        run: reloadWindow,
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
        title:
          "Connection: Disconnect SSH / Stop Reconnecting (Ends Direct Shells)",
        enabled:
          !local &&
          (connected ||
            connection.status === "connecting" ||
            !!connection.retryDelay),
        run: () => window.lwr.disconnect(),
      },
      {
        id: "explorer.toggle",
        title: "View: Toggle Explorer",
        shortcut: "Ctrl+Shift+E",
        run: () => {
          if (sidebarMode === "search") {
            setSidebarMode("explorer");
            setSidebar(true);
          } else setSidebar((value) => !value);
        },
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
      ...(["cut", "copy"] as const).map((action) => ({
        id: `file.${action}`,
        title: `File: ${action === "cut" ? "Cut" : "Copy"} File or Folder…`,
        enabled: connected && !!root,
        parameters: {
          path: "Source item; defaults to current file, otherwise prompts",
        },
        run: (args: Record<string, any>) => {
          const path = args.path || current?.path;
          return path
            ? copyFileReference(path, action === "cut")
            : setPathPrompt({
                title: `${action === "cut" ? "Cut" : "Copy"} file or folder`,
                value: root + "/",
                confirm: action === "cut" ? "Cut" : "Copy",
                action: (path) => copyFileReference(path, action === "cut"),
              });
        },
      })),
      {
        id: "file.paste",
        title: "File: Paste File or Folder",
        enabled: connected && !!fileClipboard && fileClipboard.root === root,
        parameters: {
          directory:
            "Destination folder; defaults to current file's folder or workspace",
        },
        run: (args) =>
          pasteFile(
            args.directory ||
              (current && current.path !== SETTINGS_PATH
                ? dirname(current.path)
                : root),
          ),
      },
      {
        id: "file.newFile",
        title: "File: New File…",
        enabled: connected && !!root,
        parameters: {
          directory:
            "Parent folder; defaults to the active file's folder or workspace",
          name: "Single filename; omit for a prompt",
        },
        run: (args) => {
          const directory =
            args.directory ||
            (current && current.path !== SETTINGS_PATH
              ? dirname(current.path)
              : root);
          return args.name !== undefined
            ? createItem(directory, args.name, false)
            : setPathPrompt({
                title: "New file",
                value: "",
                confirm: "Create",
                action: (name) => createItem(directory, name, false),
              });
        },
      },
      {
        id: "file.newFolder",
        title: "File: New Folder…",
        enabled: connected && !!root,
        parameters: {
          directory: "Parent folder; defaults to workspace",
          name: "Single folder name; omit for a prompt",
        },
        run: (args) =>
          args.name !== undefined
            ? createItem(args.directory || root, args.name, true)
            : setPathPrompt({
                title: "New folder",
                value: "",
                confirm: "Create",
                action: (name) =>
                  createItem(args.directory || root, name, true),
              }),
      },
      {
        id: "file.delete",
        title: "File: Delete…",
        enabled: connected && !!root,
        parameters: {
          path: "File or folder; always asks for token-checked confirmation",
        },
        run: (args) =>
          args.path || current
            ? proposeFileChange("delete", args.path || current!.path)
            : setPathPrompt({
                title: "Delete file or folder",
                value: root + "/",
                confirm: "Review",
                action: (path) => proposeFileChange("delete", path),
              }),
      },
      {
        id: "file.move",
        title: "File: Move…",
        enabled: connected && !!root,
        parameters: {
          path: "Source file or folder",
          directory: "Destination folder; keeps filename",
          destination:
            "Alternative complete destination path; omission opens a prompt",
        },
        run: (args) => {
          const source = args.path || current?.path;
          if (!source) throw new Error("Select a source file or folder first.");
          const destination =
            args.destination ||
            (args.directory
              ? resolvePath(args.directory, basename(source))
              : undefined);
          return destination
            ? proposeFileChange("move", source, destination)
            : setPathPrompt({
                title: "Move file or folder",
                value: source,
                confirm: "Review move",
                action: (destination) =>
                  proposeFileChange("move", source, destination),
              });
        },
      },
      {
        id: "file.rename",
        title: "File: Rename…",
        enabled: connected && !!root,
        parameters: {
          path: "Source file or folder",
          name: "New single name; omit for a prompt",
        },
        run: (args) => {
          const source = args.path || current?.path;
          if (!source || source === SETTINGS_PATH)
            throw new Error("Select a workspace file or folder first.");
          const rename = (name: string) => {
            if (
              typeof name !== "string" ||
              !name.trim() ||
              /[\\/\0]/.test(name) ||
              name === "." ||
              name === ".."
            )
              throw new Error("Enter a single name.");
            return proposeFileChange(
              "move",
              source,
              resolvePath(dirname(source), name),
            );
          };
          return args.name !== undefined
            ? rename(args.name)
            : setPathPrompt({
                title: "Rename",
                value: basename(source),
                confirm: "Review rename",
                action: rename,
              });
        },
      },
      {
        id: "uploads.show",
        title: "File: Show Upload Progress",
        keywords: ["transfers", "copy", "queue"],
        run: () => {
          setUploadsVisible(true);
          return window.lwr.uploads();
        },
      },
      {
        id: "uploads.hide",
        title: "File: Hide Upload Progress",
        run: () => setUploadsVisible(false),
      },
      {
        id: "uploads.stop",
        title: "File: Stop Upload…",
        parameters: {
          id: "Upload ID from uploads.show; omission opens the transfer popup to choose a file",
        },
        run: (args) =>
          args.id !== undefined
            ? window.lwr.stopUpload(args.id)
            : setUploadsVisible(true),
      },
      {
        id: "file.import",
        title: local
          ? "File: Copy Local Files into Workspace…"
          : "File: Upload Files…",
        enabled: connected && !!root,
        parameters: {
          directory: "Destination folder; defaults to workspace",
          paths:
            "Optional array of absolute local file paths; omission opens a picker",
        },
        run: async (args) => {
          try {
            const result = await window.lwr.importFiles({
              directory: args.directory || root,
              paths: args.paths,
            });
            return result;
          } finally {
            setRefresh((value) => value + 1);
          }
        },
      },
      {
        id: "file.download",
        title: "File: Download Remote File…",
        enabled: connected && !local && !!root,
        parameters: {
          path: "Remote file; defaults to current file",
          destination:
            "Optional absolute local path (must not exist); omission opens Save As",
        },
        run: async (args) => {
          const path = args.path || current?.path;
          if (!path || path === SETTINGS_PATH)
            throw new Error("Choose a remote file first.");
          markBusy("transfer", true);
          setMessage("Downloading file…");
          try {
            const result = await window.lwr.downloadFile({
              path,
              destination: args.destination,
            });
            setMessage(result ? `Saved download to ${result.path}` : "");
            return result;
          } finally {
            markBusy("transfer", false);
          }
        },
      },
      {
        id: "file.quickOpen",
        title: "File: Quick Open…",
        shortcut: "Ctrl+P",
        keywords: ["Find file", "Fuzzy file search"],
        enabled: connected && !!root,
        parameters: { query: "Optional initial fuzzy filename/path query" },
        run: (args) => {
          searchFiles(fileIndex, args.query ?? "");
          if (!fileIndex.loading && Date.now() - fileIndex.completedAt > 15000)
            setIndexRevision((value) => value + 1);
          setQuickOpen(args.query ?? "");
        },
      },
      {
        id: "file.search",
        title: "File: Search Indexed Files…",
        enabled: connected && !!root,
        parameters: {
          query: "Fuzzy query; omit to open Quick Open",
          limit: "1–200, default 100",
        },
        run: (args) =>
          args.query === undefined
            ? setQuickOpen("")
            : {
                matches: searchFiles(fileIndex, args.query, args.limit ?? 100),
                loading: fileIndex.loading,
                limited: fileIndex.limited,
                errors: fileIndex.errors,
                indexed: fileIndex.files.length,
              },
      },
      {
        id: "file.index.refresh",
        title: "File: Refresh Quick Open Index",
        enabled: connected && !!root,
        run: () => setIndexRevision((value) => value + 1),
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
        id: "file.retry",
        title: "File: Retry Loading",
        enabled: connected && !!current?.loadError,
        parameters: {
          path: "Optional failed file path",
          group: "Optional tab group ID",
        },
        run: (args) => {
          const path = args.path || current?.path;
          if (!path || !docsRef.current[path]?.loadError)
            throw new Error("Choose a file that failed to load");
          const next = { ...docsRef.current };
          delete next[path];
          docsRef.current = next;
          setDocuments(next);
          return openFile(path, args.group);
        },
      },
      {
        id: "file.save",
        title: "File: Save",
        shortcut: "Ctrl+S / :w",
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError &&
          (connected || current.path === SETTINGS_PATH),
        run: (args) => saveFile(args.path || current!.path),
      },
      {
        id: "file.saveAll",
        title: "File: Save All",
        enabled: connected || !!documents[SETTINGS_PATH],
        run: async () => {
          for (const doc of Object.values(docsRef.current))
            if (doc.text !== doc.saved && !(await saveFile(doc.path)))
              return false;
          return true;
        },
      },
      {
        id: "file.close",
        title: "File: Close Active Tab",
        shortcut: "Ctrl+W / :q",
        enabled: !!currentGroup.active,
        run: (args) =>
          closeFile(
            args.path || currentGroup.active!,
            args.group || currentGroup.id,
          ),
      },
      {
        id: "file.reload",
        title: "File: Reload from Disk",
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError &&
          (connected || current.path === SETTINGS_PATH),
        parameters: {
          path: "Optional open file path",
          discard:
            "Explicit true discards existing unsaved edits; default false refuses dirty buffers",
        },
        run: (args) =>
          reloadFile(args.path || current!.path, args.discard ?? false),
      },
      {
        id: "file.revert",
        title: "File: Revert to Saved Version",
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError &&
          (connected || current.path === SETTINGS_PATH),
        run: () =>
          setPrompt({
            title: "Discard edits and reload the saved file?",
            detail: "The saved content will replace your editor buffer.",
            confirm: "Reload saved file",
            action: () => {
              void reloadFile(current!.path, true).catch(report);
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
        enabled: !!root || !!current,
        parameters: { path: "Optional explicit file/folder path" },
        run: (args) =>
          navigator.clipboard.writeText(
            (args.path || current?.path || root) === SETTINGS_PATH
              ? settingsFile
              : args.path || current?.path || root,
          ),
      },
      {
        id: "file.copyRelativePath",
        title: "File: Copy Relative Path",
        enabled: !!root,
        parameters: {
          path: "Optional explicit file/folder path, relative to workspace root",
        },
        run: (args) => {
          const path = args.path || current?.path || root;
          if (!beneath(path, root))
            throw new Error("Choose a path inside this workspace.");
          return navigator.clipboard.writeText(
            path === root
              ? "."
              : path.slice(root.replace(/\/$/, "").length + 1),
          );
        },
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
        id: "editor.vimCommand",
        title: "Vim: Run Ex Command…",
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError &&
          vimMode &&
          current.mode !== "preview",
        parameters: {
          command:
            "One Ex command, e.g. e!, w, %s/old/new/g; omit for a prompt",
        },
        run: (args) => {
          const run = (command: string) => {
            document
              .querySelector<HTMLElement>(
                `[data-group="${currentGroup.id}"] .cm-content`,
              )
              ?.focus();
            return vimCommand(command);
          };
          return args.command !== undefined
            ? run(args.command)
            : setPathPrompt({
                title: "Vim Ex command",
                value: ":",
                action: run,
              });
        },
      },
      {
        id: "editor.vim",
        title: "Editor: Toggle Vim Mode",
        run: async () => {
          if (
            docsRef.current[SETTINGS_PATH]?.text !== undefined &&
            docsRef.current[SETTINGS_PATH].text !==
              docsRef.current[SETTINGS_PATH].saved
          )
            throw new Error(
              "Save or discard your Settings edits before toggling Vim mode.",
            );
          const file = await window.lwr.readSettings();
          const result = await window.lwr.saveSettings({
            text: editSetting(file.text, "editor.vimMode", !vimMode),
            revision: file.revision,
          });
          applySettings(result);
          patch(SETTINGS_PATH, {
            ...result,
            path: SETTINGS_PATH,
            saved: result.text,
            conflict: undefined,
          });
        },
      },
      {
        id: "settings.open",
        title: "Preferences: Open Settings",
        shortcut: "Ctrl+,",
        parameters: { group: "Optional numeric tab-group ID" },
        run: (args) => openSettings("preview", args.group),
      },
      {
        id: "settings.json",
        title: "Preferences: Open Settings (JSON)",
        parameters: { group: "Optional numeric tab-group ID" },
        run: (args) => openSettings("source", args.group),
      },
      {
        id: "settings.update",
        title: "Preferences: Change Setting…",
        parameters: {
          key: "Setting ID; omission opens Settings",
          value: "Typed value; edits buffer, use settings.save to apply",
        },
        run: (args) => {
          if (!args.key) return openSettings();
          if (!Object.hasOwn(args, "value"))
            throw new Error("Provide a typed value, or use settings.reset.");
          return updateSetting(args.key, args.value);
        },
      },
      {
        id: "settings.reset",
        title: "Preferences: Reset Setting to Default…",
        parameters: { key: "Setting ID; omission opens Settings" },
        run: (args) =>
          args.key ? updateSetting(args.key, undefined) : openSettings(),
      },
      {
        id: "settings.save",
        title: "Preferences: Save Settings",
        enabled: !!documents[SETTINGS_PATH],
        run: () => saveFile(SETTINGS_PATH),
      },
      {
        id: "settings.inspect",
        title: "Preferences: Inspect Settings",
        run: () => ({
          path: settingsFile,
          values: settings,
          definitions: Object.fromEntries(definitions),
        }),
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
            pdf: !!doc.pdf,
            unsupported: doc.unsupported,
            loading: doc.loading,
            loadError: doc.loadError,
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
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError,
        parameters: {
          path: "Optional open file path",
          text: "New unsaved buffer text; omit for a multiline editor",
        },
        run: (args) => {
          const doc = documents[args.path || current!.path];
          if (
            !doc ||
            doc.image ||
            doc.pdf ||
            doc.unsupported ||
            doc.loading ||
            doc.loadError
          )
            throw new Error("Choose an open text file");
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
        title: "Preview: Set Source / Preview Split…",
        enabled:
          !!current && (isMarkdown(current.path) || isHtml(current.path)),
        parameters: {
          group: "Optional tab group ID",
          path: "Optional Markdown or HTML path",
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
      ...(["in", "out", "reset"] as const).map((direction) => ({
        id: `preview.zoom.${direction}`,
        title: `Preview: ${direction === "reset" ? "Reset Zoom" : direction === "in" ? "Zoom In" : "Zoom Out"}`,
        shortcut:
          direction === "reset"
            ? "Ctrl+0"
            : direction === "in"
              ? "Ctrl++"
              : "Ctrl+-",
        run: () =>
          setPreviewZoom((value) => {
            const levels = [
              0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
            ];
            return direction === "reset"
              ? 1
              : direction === "in"
                ? (levels.find((level) => level > value) ?? 3)
                : ([...levels].reverse().find((level) => level < value) ?? 0.5);
          }),
      })),
      ...(
        [
          "find",
          "findNext",
          "findPrevious",
          "closeFind",
          "findState",
        ] as PreviewFindAction[]
      ).map((action) => ({
        id: `preview.${action}`,
        title: `Preview: ${{ find: "Find in Preview", findNext: "Find Next", findPrevious: "Find Previous", closeFind: "Close Find", findState: "Inspect Find State" }[action]}`,
        keywords: ["Search Markdown preview"],
        shortcut: action === "find" ? "Ctrl+F" : undefined,
        enabled: groups(layout).some((group) => {
          const doc = documents[group.active || ""];
          return (
            doc &&
            isMarkdown(doc.path) &&
            (viewModes[`${group.id}:${doc.path}`] || doc.mode) !== "source"
          );
        }),
        parameters: {
          group: "Optional editor group ID; defaults to active group",
          ...(action === "find"
            ? { search: "Optional literal search text, up to 512 characters" }
            : {}),
        },
        run: (args: Record<string, any>) =>
          previewFindCommand(
            args.group ?? groupRef.current,
            action,
            args.search,
          ),
      })),
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
        enabled:
          !!current &&
          !current.image &&
          !current.pdf &&
          !current.unsupported &&
          !current.loading &&
          !current.loadError,
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
      ...(["cut", "copy", "paste"] as const).map((action) => ({
        id: `editor.${action}`,
        title: `Editor: ${action[0].toUpperCase() + action.slice(1)} Text`,
        enabled: groups(layout).some((group) => {
          const doc = documents[group.active || ""];
          return (
            doc &&
            !doc.image &&
            !doc.pdf &&
            !doc.unsupported &&
            !doc.loading &&
            !doc.loadError &&
            (viewModes[`${group.id}:${doc.path}`] || doc.mode) !== "preview"
          );
        }),
        parameters: {
          group: "Optional group ID",
          path: "Optional expected active file path",
        },
        run: (args: Record<string, any>) => {
          const group = groups(layoutRef.current).find(
            (g) => g.id === (args.group ?? groupRef.current),
          );
          if (!group || (args.path && group.active !== args.path))
            throw new Error("The target tab has changed");
          return sourceClipboard(
            action,
            document.querySelector(`[data-group="${group.id}"] .cm-editor`),
          );
        },
      })),
      {
        id: "preview.copy",
        title: "Preview: Copy Selected Text",
        parameters: {
          group: "Optional group ID",
          text: "Optional selection captured before opening a menu",
        },
        run: (args: Record<string, any>) => {
          const pane = document.querySelector(
            `[data-group="${args.group ?? groupRef.current}"] .markdown-preview, [data-group="${args.group ?? groupRef.current}"] .pdf-page`,
          );
          const selection = window.getSelection();
          const text =
            args.text ??
            (pane &&
            selection?.anchorNode &&
            selection.focusNode &&
            pane.contains(selection.anchorNode) &&
            pane.contains(selection.focusNode)
              ? selection.toString()
              : "");
          return text ? navigator.clipboard.writeText(text) : false;
        },
      },
      ...(["source", "preview", "both"] as const).map((mode) => ({
        id: `markdown.${mode}`,
        title: `Markdown: ${{ source: "Show Raw Source", preview: "Show Preview", both: "Show Source and Preview" }[mode]}`,
        enabled: !!current && isMarkdown(current.path),
        run: (args: Record<string, any>) =>
          setMode(args.path || current!.path, mode, args.group),
      })),
      ...(["source", "preview", "both", "toggle", "refresh"] as const).map(
        (action) => ({
          id: `html.${action}`,
          title: `HTML: ${{ source: "Show Raw Source", preview: "Show Static Preview", both: "Show Source and Preview", toggle: "Toggle Preview / Raw Source", refresh: "Refresh Preview Resources" }[action]}`,
          enabled:
            !!current &&
            isHtml(current.path) &&
            !current.loading &&
            !current.loadError,
          parameters: {
            path: "Optional open HTML file path",
            group: "Optional tab group ID",
          },
          run: (args: Record<string, any>) => {
            const group = groups(layoutRef.current).find(
              (g) => g.id === (args.group ?? groupRef.current),
            );
            const path = args.path || group?.active;
            const doc = path && docsRef.current[path];
            if (
              !group ||
              !path ||
              !group.tabs.includes(path) ||
              !doc ||
              !isHtml(path) ||
              doc.loading ||
              doc.loadError
            )
              throw new Error("Choose a loaded HTML tab");
            if (action === "refresh") {
              setRefresh((v) => v + 1);
              return;
            }
            const mode = viewModes[`${group.id}:${path}`] || doc.mode;
            setMode(
              path,
              action === "toggle"
                ? mode === "preview"
                  ? "source"
                  : "preview"
                : action,
              group.id,
            );
          },
        }),
      ),
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
      ...(["Right", "Left"] as const).map((side) => ({
        id: `group.split${side}`,
        title: `Group: Split ${side}`,
        shortcut: side === "Right" ? "Ctrl+\\" : undefined,
        parameters: {
          group: "Optional source group ID",
          path: "Optional tab in that group; default active tab",
        },
        run: (args: Record<string, any>) => {
          const source = groups(layoutRef.current).find(
            (g) => g.id === (args.group ?? groupRef.current),
          );
          if (!source || (args.path && !source.tabs.includes(args.path)))
            throw new Error("Choose a tab in this group");
          splitGroup(
            args.path ? { ...source, active: args.path } : source,
            "row",
            side === "Left",
          );
        },
      })),
      {
        id: "tab.reveal",
        title: "Tab: Show in Explorer",
        parameters: {
          group: "Optional group ID",
          path: "Optional open file path",
        },
        run: (args) => {
          const target = groups(layoutRef.current).find(
            (g) => g.id === (args.group ?? groupRef.current),
          );
          const path = args.path ?? target?.active;
          if (
            !target ||
            !path ||
            !target.tabs.includes(path) ||
            path === SETTINGS_PATH ||
            !beneath(path, root) ||
            !docsRef.current[path]
          )
            throw new Error("Choose an open file inside this workspace");
          setSidebar(true);
          activate(path, target.id);
        },
      },
      {
        id: "tab.closeOthers",
        title: "Tab: Close Others",
        enabled: groups(layout).some((group) => group.tabs.length > 1),
        parameters: {
          group: "Optional group ID; default focused group",
          path: "Tab to keep; default active tab in that group",
        },
        run: (args) => {
          const group = groups(layoutRef.current).find(
            (g) => g.id === (args.group ?? groupRef.current),
          );
          const path = args.path ?? group?.active;
          if (!group || !path) throw new Error("Choose a tab in this group");
          closeOthers(path, group.id);
        },
      },
      {
        id: "tab.closeSaved",
        title: "Tab: Close All Saved Tabs",
        run: () => {
          const close = new Set(
            Object.values(docsRef.current)
              .filter(
                (doc) =>
                  doc.text === doc.saved && !saving.current.has(doc.path),
              )
              .map((doc) => doc.path),
          );
          let next = groups(layoutRef.current).reduce(
            (layout, group) =>
              mapGroup(layout, group.id, (g) => {
                const tabs = g.tabs.filter((path) => !close.has(path));
                return {
                  ...g,
                  tabs,
                  active:
                    g.active && tabs.includes(g.active) ? g.active : tabs[0],
                };
              }),
            layoutRef.current,
          );
          for (const group of groups(next))
            if (!group.tabs.length && groups(next).length > 1)
              next = removeGroup(next, group.id)!;
          setLayout(next);
          if (!groups(next).some((g) => g.id === groupRef.current))
            setActiveGroup(groups(next)[0].id);
          setDocuments((previous) =>
            Object.fromEntries(
              Object.entries(previous).filter(([path]) => !close.has(path)),
            ),
          );
        },
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
            setExplorerActivation((value) => value + 1);
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
        title: "Tab: Activate Open Tab…",
        parameters: {
          path: "Open file path or terminal ID",
          group: "Optional group ID",
        },
        enabled: groups(layout).some((group) => group.tabs.length > 0),
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
        enabled: groups(layout).length > 1,
        run: (args) => {
          const all = groups(layout);
          moveTab(
            args.path || currentGroup.active!,
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
        id: "group.tileTab",
        title: "Group: Tile Tab at Pane Edge",
        keywords: [
          "Drag split",
          "Move tab left right top bottom",
          "Tile terminal",
        ],
        parameters: {
          path: "Open file path or terminal ID; defaults to active tab",
          source: "Optional source group; inferred for open tabs",
          destination: "Target group; defaults to active group",
          edge: "left, right, top, bottom; defaults to right",
        },
        enabled:
          groups(layout).some((group) => group.tabs.length > 0) ||
          terminalSessions.length > 0,
        run: (args) => {
          const path = args.path ?? currentGroup.active;
          const source =
            args.source ??
            groups(layoutRef.current).find((group) => group.tabs.includes(path))
              ?.id;
          const terminal = terminalsRef.current.find(
            (item) => item.id === path,
          );
          if (
            typeof path !== "string" ||
            (source === undefined && terminal?.location !== "panel")
          )
            throw Error("Choose an open file or terminal tab.");
          const id = nextGroup,
            split = nextSplit;
          const next = tileOpenTab(
            layoutRef.current,
            path,
            source,
            args.destination ?? groupRef.current,
            args.edge ?? "right",
            id,
            split,
          );
          nextGroup++;
          nextSplit++;
          if (terminal) {
            updateTerminal(terminal.id, { location: "editor" });
            setActiveTerminal(terminal.id);
          }
          setViewModes((previous) => ({
            ...previous,
            [`${id}:${path}`]:
              previous[`${source}:${path}`] ||
              docsRef.current[path]?.mode ||
              "source",
          }));
          setPreviewRatios((previous) => ({
            ...previous,
            [`${id}:${path}`]: previous[`${source}:${path}`] || 0.5,
          }));
          layoutRef.current = next;
          setLayout(next);
          setActiveGroup(id);
          groupRef.current = id;
          setExplorerActivation((value) => value + 1);
          setTabDrop(null);
          return { group: id };
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
            connectionDetails: connection,
            vimMode,
            fileClipboard,
            layout,
            viewModes,
            activeGroup,
            previewRatios,
            previewZoom,
            settings,
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
              active: selectedTerminal?.id,
              sessions: terminalSessions,
            },
            diagram:
              diagramView?.kind === "diagram"
                ? {
                    title: diagramView.title,
                    scale: diagramView.scale,
                    x: diagramView.x,
                    y: diagramView.y,
                    width: diagramView.width,
                    height: diagramView.height,
                  }
                : null,
            expandedImage:
              diagramView?.kind === "image"
                ? {
                    title: diagramView.title,
                    scale: diagramView.scale,
                    x: diagramView.x,
                    y: diagramView.y,
                    width: diagramView.width,
                    height: diagramView.height,
                  }
                : null,
            documents: Object.values(documents).map((doc) => ({
              path: doc.path,
              loading: !!doc.loading,
              loadError: doc.loadError,
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
        id: "terminal.new",
        title: "Terminal: New Terminal",
        shortcut: "Ctrl+Shift+`",
        enabled: connected && !!root,
        run: () => createTerminal(),
      },
      {
        id: "terminal.select",
        title: "Terminal: Switch Terminal…",
        enabled: terminalSessions.length > 0,
        parameters: {
          id: "Optional terminal ID from workspace.state; omit to choose",
        },
        run: (args) =>
          args.id
            ? revealTerminal(terminalById(args.id))
            : setTerminalChooser(true),
      },
      ...(["next", "previous"] as const).map((direction) => ({
        id: `terminal.${direction}`,
        title: `Terminal: ${direction === "next" ? "Next" : "Previous"} Terminal`,
        enabled: terminalSessions.length > 1,
        run: () =>
          revealTerminal(
            terminalSessions[
              (terminalSessions.findIndex(
                (item) => item.id === selectedTerminal?.id,
              ) +
                (direction === "next" ? 1 : terminalSessions.length - 1)) %
                terminalSessions.length
            ],
          ),
      })),
      {
        id: "terminal.focus",
        title: "Terminal: Focus",
        enabled: connected && !!root,
        parameters: {
          id: "Optional terminal ID; defaults to selected terminal",
        },
        run: (args) => {
          if (!terminalSessions.length) return createTerminal();
          return revealTerminal(terminalById(args.id));
        },
      },
      {
        id: "terminal.rename",
        title: "Terminal: Rename Terminal…",
        enabled: terminalSessions.length > 0,
        parameters: {
          id: "Optional terminal ID",
          name: "Optional display name, up to 80 characters",
        },
        run: (args) => {
          const item = terminalById(args.id);
          const apply = (name: string) => {
            if (typeof name !== "string" || !name.trim() || name.length > 80)
              throw new Error("Enter a terminal name from 1 to 80 characters");
            updateTerminal(item.id, { name: name.trim() });
          };
          return args.name === undefined
            ? setPathPrompt({
                title: "Terminal name",
                value: item.name,
                action: apply,
              })
            : apply(args.name);
        },
      },
      {
        id: "terminal.moveToEditor",
        title: "Terminal: Move Terminal into Editor Area",
        enabled: terminalSessions.length > 0,
        parameters: {
          id: "Optional terminal ID",
          group: "Optional destination editor group ID",
        },
        run: (args) => {
          const item = terminalById(args.id),
            group = args.group ?? currentGroup.id;
          if (!groups(layoutRef.current).some((item) => item.id === group))
            throw new Error("Unknown editor group");
          detachTerminalTab(item.id);
          updateTerminal(item.id, { location: "editor" });
          activate(item.id, group);
          setActiveTerminal(item.id);
          if (panelTerminals.length === 1 && item.location === "panel")
            setTerminalVisible(false);
        },
      },
      {
        id: "terminal.moveToPanel",
        title: "Terminal: Move Terminal into Panel",
        enabled: terminalSessions.length > 0,
        parameters: { id: "Optional terminal ID" },
        run: (args) => {
          const item = terminalById(args.id);
          detachTerminalTab(item.id);
          updateTerminal(item.id, { location: "panel" });
          setActiveTerminal(item.id);
          setTerminalVisible(true);
        },
      },
      {
        id: "terminal.close",
        title: "Terminal: Kill Terminal",
        enabled: terminalSessions.length > 0,
        parameters: {
          id: "Optional terminal ID; running shells require confirmation",
        },
        run: (args) => closeTerminal(args.id),
      },
      {
        id: "terminal.restart",
        title: "Terminal: Restart Shell",
        enabled: connected && terminalSessions.length > 0,
        parameters: { id: "Optional terminal ID" },
        run: (args) => {
          const item = terminalById(args.id);
          setPrompt({
            title: "Start a new shell?",
            detail: `The shell in ${item.name} is replaced. Other terminals stay open.`,
            confirm: "Restart terminal",
            action: () =>
              updateTerminal(item.id, {
                restart: item.restart + 1,
                status: "starting",
                pty: undefined,
              }),
          });
        },
      },
      {
        id: "terminal.start",
        title: "Terminal: Start Shell After Reconnect",
        enabled:
          connected &&
          terminalSessions.some((item) => item.status === "disconnected"),
        parameters: { id: "Optional disconnected terminal ID" },
        run: (args) => {
          const item = terminalById(args.id);
          if (item.status !== "disconnected")
            throw new Error("This terminal does not need reconnecting");
          updateTerminal(item.id, {
            restart: item.restart + 1,
            status: "starting",
            pty: undefined,
          });
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
        enabled: connected && terminalSessions.length > 0,
        parameters: {
          id: "Optional terminal ID; defaults to selected terminal",
          text: "Literal terminal input; include a carriage return only when execution is intended",
        },
        run: (args) => {
          const apply = (text: string) => {
            if (typeof text !== "string")
              throw new Error("Terminal input must be text");
            const item = terminalById(args.id);
            if (!["starting", "running"].includes(item.status))
              throw new Error("Restart this terminal before sending input");
            const detail = { id: item.id, text, accepted: false };
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
      ...(
        [
          "nextPage",
          "previousPage",
          "page",
          "zoomIn",
          "zoomOut",
          "fitWidth",
          "actualSize",
          "copyPageText",
          "state",
        ] as PdfAction[]
      ).map((action) => ({
        id: `pdf.${action}`,
        title: `PDF: ${{ nextPage: "Next Page", previousPage: "Previous Page", page: "Go to Page…", zoomIn: "Zoom In", zoomOut: "Zoom Out", fitWidth: "Fit to Width", actualSize: "Actual Size", copyPageText: "Copy Page Text", state: "Inspect Viewer State" }[action]}`,
        enabled: groups(layout).some((g) => !!documents[g.active || ""]?.pdf),
        parameters: {
          group: "Optional group ID (default: active group)",
          ...(action === "page"
            ? { page: "1-based page number; omitted opens a prompt" }
            : {}),
        },
        run: (args: Record<string, any>) => {
          const target = args.group ?? groupRef.current;
          if (action === "page" && args.page === undefined)
            return setPathPrompt({
              title: "Go to PDF page",
              value: "1",
              action: (value) =>
                pdfCommand(target, action, { page: Number(value) }),
            });
          return pdfCommand(target, action, args);
        },
      })),
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
      if (state.status === "disconnected")
        setTerminalSessions((items) =>
          items.map((item) => ({ ...item, status: "disconnected" })),
        );
      setConnection(state);
      if (state.status === "connected") {
        setRestoringConnection(false);
        if (state.kind === "ssh" && initialRoot.current === undefined)
          setRoot((current) => current || state.home || "/");
        setRefresh((value) => value + 1);
      }
      if (state.error && !state.retryDelay) report(state.error);
    });
    window.lwr.bootstrap().then(async (config) => {
      initialRoot.current = config.root;
      if (config.reloadState) {
        initialTerminal.current = true;
        setRestoringConnection(true);
      }
      setConnection(config.connection);
      // Retain the requested workspace even when the initial SSH attempt fails.
      if (config.root !== undefined) setRoot(config.root);
      try {
        let preferences = await window.lwr.readSettings();
        if (preferences.revision === "missing" && legacyVim.current)
          preferences = await window.lwr.saveSettings({
            text: editSetting(preferences.text, "editor.vimMode", true),
            revision: preferences.revision,
          });
        applySettings(preferences);
      } catch (error) {
        report(error);
      }
      const ready = window.lwr.connect();
      if (config.reloadState) restoreWindow(config.reloadState, ready);
      try {
        const state = await ready;
        setRestoringConnection(false);
        setConnection(state);
        setRoot(config.root ?? state.home ?? "/");
        if (config.root === "") setTerminalVisible(false);
        if (!config.reloadState && config.file) void openFile(config.file, 1);
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
    let stopped = false,
      pending = false,
      lastError = "";
    async function refreshSettings() {
      if (pending) return;
      pending = true;
      try {
        const file = await readDocument(SETTINGS_PATH);
        if (
          stopped ||
          saving.current.has(SETTINGS_PATH) ||
          file.revision === settingsRevision.current
        )
          return;
        const doc = docsRef.current[SETTINGS_PATH];
        if (doc && doc.text === doc.saved)
          patch(SETTINGS_PATH, {
            ...file,
            saved: file.text,
            conflict: undefined,
          });
        // A dirty Settings buffer keeps its revision; Save checks for conflicts.
        applySettings(file);
        lastError = "";
      } catch (error) {
        if (!stopped && String(error) !== lastError) {
          lastError = String(error);
          report(error);
        }
      } finally {
        pending = false;
      }
    }
    void refreshSettings();
    const timer = setInterval(refreshSettings, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("lwr-vim", String(vimMode));
  }, [vimMode]);
  useEffect(() => {
    const previewZoomShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey
      )
        return;
      const direction =
        ["+", "="].includes(event.key) || event.code === "NumpadAdd"
          ? "in"
          : event.key === "-" || event.code === "NumpadSubtract"
            ? "out"
            : event.key === "0" || event.code === "Numpad0"
              ? "reset"
              : null;
      if (
        !direction ||
        document.querySelector(".diagram-viewer, .palette-shade, .modal-shade")
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const pane = target?.closest<HTMLElement>("[data-preview-group]");
      // Tab/Explorer clicks can leave focus outside the active preview. Source
      // editors, terminals and other inputs still own their keyboard shortcuts.
      if (
        !pane &&
        (target?.closest(
          ".cm-editor, .terminal-host, input, textarea, [contenteditable]",
        ) ||
          !document.querySelector(`[data-preview-group="${groupRef.current}"]`))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      execute(`preview.zoom.${direction}`);
    };
    window.addEventListener("keydown", previewZoomShortcut, true);
    return () =>
      window.removeEventListener("keydown", previewZoomShortcut, true);
  }, [commandApi]);
  useEffect(() => {
    const quickOpenShortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        event.stopPropagation();
        execute("search.open");
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        event.stopPropagation();
        execute("file.quickOpen");
      }
    };
    window.addEventListener("keydown", quickOpenShortcut, true);
    return () => window.removeEventListener("keydown", quickOpenShortcut, true);
  }, [commandApi]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      // Respect editor/Vim bindings, particularly Ctrl+R (redo) and Ctrl+W.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setFileMenu(null);
        setQuickOpen(null);
        setTerminalChooser(false);
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
      else if ((event.ctrlKey || event.metaKey) && key === ",")
        id = "settings.open";
      else if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        key === "f" &&
        !(event.target as HTMLElement)?.closest(
          ".cm-editor, .terminal-host, input, textarea",
        ) &&
        !document.querySelector(
          ".diagram-viewer, .palette-shade, .modal-shade",
        ) &&
        document.querySelector(`[data-preview-group="${groupRef.current}"]`)
      )
        id = "preview.find";
      else if ((event.ctrlKey || event.metaKey) && key === "s")
        id = "file.save";
      else if (event.ctrlKey && key === "`") id = "terminal.toggle";
      else if (event.ctrlKey && event.shiftKey && key === "~")
        id = "terminal.new";
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
            .filter(
              (path): path is string =>
                !!path &&
                path !== SETTINGS_PATH &&
                !!docsRef.current[path] &&
                !docsRef.current[path].loading &&
                !docsRef.current[path].loadError &&
                !docsRef.current[path].unsupported,
            ),
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
          if (doc.pdf) {
            const result = await window.lwr.remote<{
              data: string;
              stamp: string;
            }>("pdf", { path: stat.path });
            if (!cancelled)
              patch(stat.path, {
                pdf: result.data,
                stamp: result.stamp,
                missing: false,
              });
          } else if (doc.image) {
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
  function terminalSlot(item: TerminalSession) {
    return (
      <>
        {item.status === "disconnected" && (
          <div className="terminal-disconnected">
            <span>
              {connected
                ? "Your old shell ended when SSH disconnected."
                : connection.retryDelay || connection.status === "connecting"
                  ? "SSH disconnected. Reconnecting automatically…"
                  : "SSH disconnected. Reconnect to continue."}
            </span>
            {connected && (
              <button
                onClick={() => execute("terminal.start", { id: item.id })}
              >
                Start new shell
              </button>
            )}
          </div>
        )}
        <div className="terminal-slot" id={"terminal-slot-" + item.id} />
      </>
    );
  }
  function renderGroup(group: Group): ReactNode {
    const terminal = terminalSessions.find((item) => item.id === group.active);
    const file = group.active ? documents[group.active] : undefined;
    const doc = file
      ? { ...file, mode: viewModes[`${group.id}:${file.path}`] || file.mode }
      : undefined;
    return (
      <section
        className={`editor-group ${activeGroup === group.id ? "active-group" : ""}`}
        data-group={group.id}
        onContextMenuCapture={(event) => {
          const target = event.target as HTMLElement;
          const editor = target.closest<HTMLElement>(".cm-content");
          const preview = target.closest<HTMLElement>(
            ".markdown-preview, .pdf-page",
          );
          if ((!editor && !preview) || !doc) return;
          event.preventDefault();
          event.stopPropagation();
          const view = sourceView(editor);
          const selection = window.getSelection();
          const text = view
            ? view.state.sliceDoc(
                view.state.selection.main.from,
                view.state.selection.main.to,
              )
            : preview &&
                selection?.anchorNode &&
                selection.focusNode &&
                preview.contains(selection.anchorNode) &&
                preview.contains(selection.focusNode)
              ? selection.toString()
              : "";
          setFileMenu(null);
          setTextMenu({
            x: event.clientX,
            y: event.clientY,
            group: group.id,
            path: doc.path,
            kind: editor ? "editor" : "preview",
            text,
          });
        }}
        onPointerDown={() => execute("group.focus", { group: group.id })}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (
            !types.includes("application/lwr-tab") &&
            !types.includes("application/owlet-terminal") &&
            !types.includes("application/owlet-file")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (types.includes("application/owlet-file")) return;
          const edge = (event.target as HTMLElement).closest(".tabs-bar")
            ? "center"
            : dropEdge(
                event.currentTarget.getBoundingClientRect(),
                event.clientX,
                event.clientY,
              );
          event.dataTransfer.dropEffect = "move";
          setTabDrop((previous) =>
            previous?.group === group.id && previous.edge === edge
              ? previous
              : { group: group.id, edge },
          );
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setTabDrop(null);
        }}
        onDrop={(event) => {
          const types = event.dataTransfer.types;
          if (
            !types.includes("application/lwr-tab") &&
            !types.includes("application/owlet-terminal") &&
            !types.includes("application/owlet-file")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          setTabDrop(null);
          const edge = (event.target as HTMLElement).closest(".tabs-bar")
            ? "center"
            : dropEdge(
                event.currentTarget.getBoundingClientRect(),
                event.clientX,
                event.clientY,
              );
          try {
            const entry = event.dataTransfer.getData("application/owlet-file");
            if (entry) {
              const file = JSON.parse(entry);
              if (!file.directory)
                execute("file.open", { path: file.path, group: group.id });
              return;
            }
            const terminalId = event.dataTransfer.getData(
              "application/owlet-terminal",
            );
            if (terminalId) {
              execute(
                edge === "center" ? "terminal.moveToEditor" : "group.tileTab",
                {
                  id: terminalId,
                  group: group.id,
                  path: terminalId,
                  destination: group.id,
                  edge,
                },
              );
              return;
            }
            const { path, source } = JSON.parse(
              event.dataTransfer.getData("application/lwr-tab"),
            );
            if (edge !== "center" || source !== group.id)
              execute(edge === "center" ? "group.moveTab" : "group.tileTab", {
                path,
                source,
                destination: group.id,
                edge,
              });
          } catch {}
        }}
      >
        {tabDrop?.group === group.id && (
          <div
            className={`tab-drop-preview drop-${tabDrop.edge}`}
            data-edge={tabDrop.edge}
            aria-hidden="true"
          >
            <span>
              {tabDrop.edge === "center"
                ? "Move tab here"
                : `Split ${tabDrop.edge}`}
            </span>
          </div>
        )}
        <div className="tabs-bar">
          <TabStrip active={group.active}>
            {group.tabs.map((path) => {
              const terminalTab = terminalSessions.find(
                (item) => item.id === path,
              );
              const label =
                terminalTab?.name ||
                (path === SETTINGS_PATH ? "Settings" : basename(path));
              const item = documents[path],
                isDirty = item && item.text !== item.saved;
              return (
                <div
                  key={path}
                  className={`tab ${group.active === path ? "active-tab" : ""}`}
                  role="tab"
                  aria-label={
                    item?.unsupported
                      ? `${label} — Unsupported file`
                      : undefined
                  }
                  aria-selected={group.active === path}
                  draggable
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    event.stopPropagation();
                    execute("file.close", { path, group: group.id });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTextMenu(null);
                    setFileMenu({
                      path,
                      directory: false,
                      x: event.clientX,
                      y: event.clientY,
                      group: group.id,
                    });
                  }}
                  title={
                    terminalTab ? `${label} · ${terminalTab.status}` : path
                  }
                  data-terminal-tab={terminalTab?.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/lwr-tab",
                      JSON.stringify({ path, source: group.id }),
                    );
                  }}
                  onClick={() =>
                    execute("tab.activate", { path, group: group.id })
                  }
                >
                  {item?.loading ? (
                    <RefreshCw
                      size={15}
                      className="file-loading-spinner"
                      aria-label="Loading"
                    />
                  ) : item?.unsupported ? (
                    <AlertTriangle size={15} />
                  ) : terminalTab ? (
                    <TerminalSquare size={15} />
                  ) : path === SETTINGS_PATH ? (
                    <SettingsIcon size={15} />
                  ) : (
                    <FileIcon path={path} />
                  )}
                  <span>{label}</span>
                  {isDirty && (
                    <span
                      className="dirty-dot"
                      title="Unsaved changes"
                      aria-label="Unsaved changes"
                    />
                  )}
                  <button
                    className="tab-close"
                    title={`Close ${label}`}
                    aria-label={`Close ${label}`}
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
          </TabStrip>
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
        {terminal ? (
          <div className="editor-terminal">
            <div
              className="terminal-toolbar"
              role="toolbar"
              aria-label={`${terminal.name} controls`}
            >
              {terminal.status !== "running" && (
                <span className="terminal-status">{terminal.status}</span>
              )}
              <div className="actions">
                <button
                  title="Rename terminal"
                  aria-label="Rename terminal"
                  onClick={() =>
                    execute("terminal.rename", { id: terminal.id })
                  }
                >
                  <Pencil size={13} />
                </button>
                <button
                  title="Move terminal to panel"
                  aria-label="Move terminal to panel"
                  onClick={() =>
                    execute("terminal.moveToPanel", { id: terminal.id })
                  }
                >
                  <ArrowDownLeft size={14} />
                </button>
                <button
                  title="Restart terminal"
                  aria-label="Restart terminal"
                  onClick={() =>
                    execute("terminal.restart", { id: terminal.id })
                  }
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>
            {terminalSlot(terminal)}
          </div>
        ) : doc ? (
          <>
            <div className="document-toolbar">
              <div className="breadcrumbs" title={doc.path}>
                <span>
                  {doc.path === SETTINGS_PATH
                    ? "User settings"
                    : dirname(doc.path).replace(root, basename(root))}
                </span>
                <ChevronRight size={12} />
                <strong>{basename(doc.path)}</strong>
              </div>
              <div className="document-actions">
                {doc.path === SETTINGS_PATH && (
                  <div className="mode-switch">
                    <button
                      className={doc.mode !== "source" ? "chosen" : ""}
                      aria-label="Settings UI"
                      onClick={() =>
                        execute("settings.open", { group: group.id })
                      }
                    >
                      <SettingsIcon size={13} /> UI
                    </button>
                    <button
                      className={doc.mode === "source" ? "chosen" : ""}
                      aria-label="Settings JSON"
                      onClick={() =>
                        execute("settings.json", { group: group.id })
                      }
                    >
                      <Code2 size={13} /> JSON
                    </button>
                  </div>
                )}
                {!doc.unsupported &&
                  !doc.loading &&
                  !doc.loadError &&
                  (isMarkdown(doc.path) || isHtml(doc.path)) && (
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
                            execute(
                              `${isHtml(doc.path) ? "html" : "markdown"}.${mode}`,
                              {
                                path: doc.path,
                                group: group.id,
                              },
                            )
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
                {isHtml(doc.path) &&
                  !doc.loading &&
                  !doc.loadError &&
                  doc.mode !== "source" && (
                    <button
                      aria-label="Refresh HTML preview"
                      title="Refresh HTML preview"
                      onClick={() =>
                        execute("html.refresh", {
                          path: doc.path,
                          group: group.id,
                        })
                      }
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                {!doc.image &&
                  !doc.pdf &&
                  !doc.unsupported &&
                  !doc.loading &&
                  !doc.loadError && (
                    <button
                      title="Save (Ctrl+S)"
                      aria-label="Save file"
                      disabled={
                        busy.has(doc.path) ||
                        doc.text === doc.saved ||
                        (doc.path !== SETTINGS_PATH &&
                          connection.status !== "connected")
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
              {doc.loading ? (
                <div
                  className="file-load-state"
                  role="status"
                  aria-live="polite"
                >
                  <RefreshCw size={20} className="file-loading-spinner" />
                  <span>Loading {basename(doc.path)}…</span>
                </div>
              ) : doc.loadError ? (
                <div className="file-load-state" role="alert">
                  <AlertTriangle size={24} />
                  <h2>Could not load file</h2>
                  <p>{doc.loadError}</p>
                  <button
                    onClick={() =>
                      execute("file.retry", { path: doc.path, group: group.id })
                    }
                  >
                    Retry
                  </button>
                </div>
              ) : doc.unsupported ? (
                <div className="unsupported-file" role="status">
                  <AlertTriangle size={28} />
                  <h2>Unsupported file</h2>
                  <p>
                    Owlet cannot display <strong>{basename(doc.path)}</strong>.
                  </p>
                  <p>{doc.unsupported}</p>
                  <p className="unsupported-hint">
                    This temporary tab closes when you switch away.
                  </p>
                </div>
              ) : doc.path === SETTINGS_PATH && doc.mode !== "source" ? (
                <SettingsView
                  text={doc.text}
                  file={settingsFile}
                  onCommand={(id, args) =>
                    execute(id, { ...args, group: group.id })
                  }
                />
              ) : doc.pdf ? (
                <Suspense
                  fallback={<div className="loading">Preparing PDF…</div>}
                >
                  <PdfViewer
                    data={doc.pdf}
                    path={doc.path}
                    group={group.id}
                    onCommand={execute}
                    onUnavailable={(reason) => unsupportedPreview(doc, reason)}
                  />
                </Suspense>
              ) : doc.image ? (
                <ImageViewer
                  document={doc}
                  onCommand={execute}
                  onUnavailable={(reason) => unsupportedPreview(doc, reason)}
                />
              ) : doc.mode === "both" &&
                (isMarkdown(doc.path) || isHtml(doc.path)) ? (
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
                      wordWrap={settings["editor.wordWrap"]}
                      fontSettings={settings}
                      onChange={(value) => patch(doc.path, { text: value })}
                      onSave={() =>
                        commandApi.execute("file.save", {
                          path: doc.path,
                        }) as Promise<boolean>
                      }
                      onSaveAll={() =>
                        commandApi.execute("file.saveAll") as Promise<boolean>
                      }
                      onReload={(discard) =>
                        commandApi.execute("file.reload", {
                          path: doc.path,
                          discard,
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
                      {isHtml(doc.path) ? (
                        <HtmlPreview
                          text={doc.text}
                          path={doc.path}
                          root={root}
                          refresh={refresh}
                        />
                      ) : (
                        <Preview
                          group={group.id}
                          zoom={previewZoom}
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
                      )}
                    </Suspense>
                  }
                />
              ) : doc.mode === "preview" &&
                (isMarkdown(doc.path) || isHtml(doc.path)) ? (
                <Suspense
                  fallback={<div className="loading">Preparing preview…</div>}
                >
                  {isHtml(doc.path) ? (
                    <HtmlPreview
                      text={doc.text}
                      path={doc.path}
                      root={root}
                      refresh={refresh}
                    />
                  ) : (
                    <Preview
                      group={group.id}
                      zoom={previewZoom}
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
                  )}
                </Suspense>
              ) : (
                <Editor
                  cacheKey={group.id + ":" + doc.path}
                  path={doc.path}
                  value={doc.text}
                  vimMode={vimMode}
                  wordWrap={settings["editor.wordWrap"]}
                  fontSettings={settings}
                  onChange={(value) => patch(doc.path, { text: value })}
                  onSave={() =>
                    commandApi.execute("file.save", {
                      path: doc.path,
                    }) as Promise<boolean>
                  }
                  onSaveAll={() =>
                    commandApi.execute("file.saveAll") as Promise<boolean>
                  }
                  onReload={(discard) =>
                    commandApi.execute("file.reload", {
                      path: doc.path,
                      discard,
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
          <Welcome
            logo={owletLogo}
            recent={recent}
            workspaceReady={connected && !!root}
            hasWorkspace={!!root}
            connection={connection}
            execute={execute}
          />
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
  const contextItems: MenuItem[] = fileMenu
    ? (() => {
        const path = fileMenu.path,
          directory = fileMenu.directory ? path : dirname(path);
        const workspaceItem =
          !!root && beneath(path, root) && path !== SETTINGS_PATH;
        if (fileMenu.group !== undefined) {
          const args = { path, group: fileMenu.group },
            file = !!documents[path];
          return [
            {
              label: "Copy Path",
              id: "file.copyPath",
              args: { path },
              disabled: !file,
            },
            {
              label: "Copy Relative Path",
              id: "file.copyRelativePath",
              args: { path },
              disabled: !file || !workspaceItem,
            },
            null,
            { label: "Split Right", id: "group.splitRight", args },
            { label: "Split Left", id: "group.splitLeft", args },
            {
              label: "Show in Explorer",
              id: "tab.reveal",
              args,
              disabled: !file || !workspaceItem,
            },
            null,
            {
              label: "Close Others",
              id: "tab.closeOthers",
              args,
              disabled: !groups(layout).some(
                (group) => group.id === fileMenu.group && group.tabs.length > 1,
              ),
            },
            { label: "Close All Saved Tabs", id: "tab.closeSaved" },
          ];
        }
        const items: MenuItem[] = [
          {
            label: "New File…",
            id: "file.newFile",
            args: { directory },
            disabled: !workspaceItem || !connected,
          },
          {
            label: "New Folder…",
            id: "file.newFolder",
            args: { directory },
            disabled: !workspaceItem || !connected,
          },
          null,
          {
            label: "Cut",
            id: "file.cut",
            args: { path },
            disabled: !workspaceItem || path === root || !connected,
          },
          {
            label: "Copy",
            id: "file.copy",
            args: { path },
            disabled: !workspaceItem || path === root || !connected,
          },
          {
            label: "Paste",
            id: "file.paste",
            args: { directory },
            disabled:
              !workspaceItem ||
              !connected ||
              !fileClipboard ||
              fileClipboard.root !== root,
          },
          null,
          { label: "Copy Path", id: "file.copyPath", args: { path } },
          {
            label: "Copy Relative Path",
            id: "file.copyRelativePath",
            args: { path },
            disabled: !workspaceItem,
          },
          null,
        ];
        if (!local && !fileMenu.directory)
          items.push({
            label: "Download…",
            id: "file.download",
            args: { path },
            disabled: !workspaceItem || !connected,
          });
        if (fileMenu.directory)
          items.push({
            label: "Find in Folder…",
            id: "search.scope",
            args: { directory },
            disabled: !workspaceItem || !connected,
          });
        if (fileMenu.directory)
          items.push({
            label: local ? "Copy Files Here…" : "Upload Files Here…",
            id: "file.import",
            args: { directory },
            disabled: !workspaceItem || !connected,
          });
        items.push({
          label: "Rename…",
          id: "file.rename",
          args: { path },
          disabled: !workspaceItem || path === root || !connected,
        });
        items.push({
          label: "Delete",
          id: "file.delete",
          args: { path },
          danger: true,
          disabled: !workspaceItem || path === root || !connected,
        });
        if (fileMenu.group !== undefined)
          items.push(null, {
            label: "Close Tab",
            id: "file.close",
            args: { path, group: fileMenu.group },
          });
        return items;
      })()
    : [];
  return (
    <div
      className="app-shell"
      style={
        {
          ...appearance.style,
          "--editor-font-size": `${settings["editor.fontSize"]}px`,
          "--editor-font-family": settings["editor.fontFamily"],
          "--editor-line-height": settings["editor.lineHeight"],
          "--preview-font-size": `${settings["preview.fontSize"]}px`,
          "--preview-font-family": settings["preview.fontFamily"],
          "--preview-line-height": settings["preview.lineHeight"],
          "--preview-max-width": settings["preview.maxWidth"]
            ? `${settings["preview.maxWidth"]}px`
            : "none",
        } as React.CSSProperties
      }
    >
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
            aria-label="Open settings"
            title="Settings (Ctrl+,)"
            onClick={() => execute("settings.open")}
          >
            <SettingsIcon size={16} />
          </button>
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
      {quickOpen !== null && (
        <QuickOpen
          index={fileIndex}
          initialQuery={quickOpen}
          onCommand={execute}
          onClose={() => setQuickOpen(null)}
        />
      )}
      {fileMenu && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          label={fileMenu.group !== undefined ? "Tab actions" : "File actions"}
          items={contextItems}
          onCommand={execute}
          onClose={() => setFileMenu(null)}
        />
      )}
      {textMenu && (
        <ContextMenu
          x={textMenu.x}
          y={textMenu.y}
          label="Text actions"
          items={
            textMenu.kind === "editor"
              ? ["cut", "copy", "paste"].map((action) => ({
                  id: `editor.${action}`,
                  label: action[0].toUpperCase() + action.slice(1),
                  args: { group: textMenu.group, path: textMenu.path },
                  disabled: action !== "paste" && !textMenu.text,
                }))
              : [
                  {
                    id: "preview.copy",
                    label: "Copy",
                    args: { group: textMenu.group, text: textMenu.text },
                    disabled: !textMenu.text,
                  },
                ]
          }
          onCommand={execute}
          onClose={() => setTextMenu(null)}
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
              <div
                style={{
                  height: "100%",
                  display: sidebarMode === "explorer" ? undefined : "none",
                }}
              >
                <Explorer
                  navigation={
                    <nav className="sidebar-navigation">
                      <button
                        aria-label="Show Explorer"
                        aria-pressed={true}
                        onClick={() => execute("explorer.show")}
                      >
                        <FolderOpen size={13} />
                        Files
                      </button>
                      <button
                        aria-label="Show Project Search"
                        onClick={() => execute("search.open")}
                      >
                        <SearchIcon size={13} />
                      </button>
                    </nav>
                  }
                  uploads={uploads}
                  cutPath={fileClipboard?.cut ? fileClipboard.path : undefined}
                  onContext={(path, directory, x, y) =>
                    setFileMenu({ path, directory, x, y })
                  }
                  root={root}
                  selected={current?.path}
                  activation={explorerActivation}
                  focusSelected={!!current?.unsupported}
                  visible={sidebar && sidebarMode === "explorer"}
                  caseInsensitive={local}
                  connection={connection}
                  revision={refresh}
                  onOpen={(path) => execute("file.open", { path })}
                  onFolder={() => execute("window.openFolder")}
                  onRefresh={() => execute("explorer.refresh")}
                  onError={report}
                  onCommand={execute}
                />
              </div>
              <div
                style={{
                  height: "100%",
                  display: sidebarMode === "search" ? undefined : "none",
                }}
              >
                <ProjectSearch
                  model={projectSearch}
                  root={root}
                  settings={settings}
                  dirty={dirty}
                  onCommand={execute}
                  navigation={
                    <nav className="sidebar-navigation">
                      <button
                        aria-label="Show Explorer"
                        onClick={() => execute("explorer.show")}
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        aria-label="Show Project Search"
                        aria-pressed={true}
                        onClick={() => execute("search.open")}
                      >
                        <SearchIcon size={13} />
                        Search
                      </button>
                    </nav>
                  }
                />
              </div>
            </div>
            <div
              className="sidebar-handle"
              style={{ display: sidebar ? undefined : "none" }}
              role="separator"
              aria-label="Resize Explorer"
              aria-orientation="vertical"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                sidebarResize.current = {
                  pointer: event.pointerId,
                  x: event.clientX,
                  width: sidebarWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = sidebarResize.current;
                if (
                  drag?.pointer === event.pointerId &&
                  event.currentTarget.hasPointerCapture(event.pointerId)
                )
                  execute("explorer.setWidth", {
                    width: drag.width + event.clientX - drag.x,
                  });
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                sidebarResize.current = null;
              }}
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
              <div
                className="terminal-toolbar"
                role="toolbar"
                aria-label="Terminal controls"
              >
                <div className="actions">
                  <button
                    title="New terminal"
                    aria-label="New terminal"
                    disabled={!connected || !root}
                    onClick={() => execute("terminal.new")}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    title="Move terminal to editor"
                    aria-label="Move terminal to editor"
                    disabled={!panelTerminal}
                    onClick={() =>
                      execute("terminal.moveToEditor", {
                        id: panelTerminal?.id,
                      })
                    }
                  >
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    title="Rename terminal"
                    aria-label="Rename terminal"
                    disabled={!panelTerminal}
                    onClick={() =>
                      execute("terminal.rename", { id: panelTerminal?.id })
                    }
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    title="Kill terminal"
                    aria-label="Kill terminal"
                    disabled={!panelTerminal}
                    onClick={() =>
                      execute("terminal.close", { id: panelTerminal?.id })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    title="Restart terminal"
                    aria-label="Restart terminal"
                    disabled={!panelTerminal}
                    onClick={() =>
                      execute("terminal.restart", { id: panelTerminal?.id })
                    }
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
              <div
                className="terminal-body"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  try {
                    const tab = JSON.parse(
                      event.dataTransfer.getData("application/lwr-tab"),
                    );
                    if (
                      terminalsRef.current.some((item) => item.id === tab.path)
                    )
                      execute("terminal.moveToPanel", { id: tab.path });
                  } catch {}
                }}
              >
                <div className="terminal-content">
                  {panelTerminal ? (
                    terminalSlot(panelTerminal)
                  ) : (
                    <div className="terminal-disconnected">
                      <button
                        disabled={!connected || !root}
                        onClick={() => execute("terminal.new")}
                      >
                        New terminal
                      </button>
                    </div>
                  )}
                </div>
                {panelTerminals.length > 1 && (
                  <div
                    className="terminal-list"
                    role="listbox"
                    aria-label="Terminals"
                  >
                    {panelTerminals.map((item) => (
                      <div
                        className={`terminal-list-row${panelTerminal?.id === item.id ? " selected" : ""}`}
                        key={item.id}
                      >
                        <button
                          role="option"
                          aria-selected={panelTerminal?.id === item.id}
                          title={item.name + " · " + item.status}
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/owlet-terminal",
                              item.id,
                            )
                          }
                          onClick={() =>
                            execute("terminal.select", { id: item.id })
                          }
                          onDoubleClick={() =>
                            execute("terminal.rename", { id: item.id })
                          }
                        >
                          <TerminalSquare size={13} />
                          <span>{item.name}</span>
                          <small>
                            {item.status === "running" ? "" : item.status}
                          </small>
                        </button>
                        <button
                          className="terminal-row-close"
                          aria-label={"Kill " + item.name}
                          title="Kill terminal"
                          onClick={() =>
                            execute("terminal.close", { id: item.id })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      {diagramView && (
        <DiagramViewer
          key={diagramView.id}
          diagram={diagramView}
          onCommand={execute}
        />
      )}
      <Suspense fallback={null}>
        {terminalSessions.map((item) => (
          <TerminalPane
            settings={settings}
            key={item.id}
            id={item.id}
            root={restoringConnection ? "" : item.path}
            connection={connection}
            restart={item.restart}
            destination={"terminal-slot-" + item.id}
            onError={report}
            onFocus={() => {
              setActiveTerminal(item.id);
              dismissUnsupported();
            }}
            onStatus={(status, pty) => updateTerminal(item.id, { status, pty })}
          />
        ))}
      </Suspense>
      {terminalChooser && (
        <div className="modal-shade">
          <div className="modal" role="dialog" aria-label="Switch terminal">
            <h2>Switch terminal</h2>
            {terminalSessions.map((item) => (
              <button
                className="terminal-choice"
                key={item.id}
                onClick={() => {
                  setTerminalChooser(false);
                  execute("terminal.select", { id: item.id });
                }}
              >
                <TerminalSquare size={15} />
                {item.name}
                <small>
                  {item.location} · {item.status}
                </small>
              </button>
            ))}
            <div className="modal-actions">
              <button onClick={() => setTerminalChooser(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="notification-stack">
        {uploadsVisible && <Uploads items={uploads} onCommand={execute} />}
        {message && (
          <div
            className={`toast ${/^(saved|connected|created|moved|deleted|copying|copied|cut|uploading|downloading|downloaded)/i.test(message) ? "" : "error-toast"}`}
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
      </div>
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
            title={`${connection.status} · ${connection.target}\n${connection.error || root || "Opening workspace"}\nOpen a folder`}
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
                ? connection.retryAttempt
                  ? "Reconnecting…"
                  : "Connecting…"
                : connection.retryDelay
                  ? `Retrying in ${connection.retryDelay / 1000}s…`
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
          {uploads.length > 0 && (
            <button
              title="Show upload progress"
              onClick={() => execute("uploads.show")}
            >
              {uploads.filter(uploading).length
                ? `Transferring ${uploads.filter(uploading).length}`
                : "Transfers"}
            </button>
          )}
          <button
            className={vimMode ? "vim-active" : ""}
            aria-label="Toggle Vim mode"
            aria-pressed={vimMode}
            onClick={() => execute("editor.vim")}
          >
            {vimMode ? "VIM ON" : "VIM OFF"}
          </button>
          {!current?.pdf && !current?.image && !current?.unsupported && (
            <span>UTF-8</span>
          )}
          <span>
            {current?.pdf
              ? "PDF"
              : current?.image
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
          history={commandHistory}
          onClose={() => setPaletteVisible(false)}
          onExecute={executePalette}
        />
      )}
      {appearance.dialog}
      {about.dialog}
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
                {pathPrompt.confirm || "Open"}
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
