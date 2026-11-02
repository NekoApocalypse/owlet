import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  historyField,
  indentWithTab,
  undo,
  redo,
  selectAll,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  indentOnInput,
} from "@codemirror/language";
import {
  searchKeymap,
  search,
  highlightSelectionMatches,
  openSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { editorLanguage } from "./editorLanguages";
import {
  vim,
  Vim,
  getCM,
  type ExParams,
  type CodeMirrorV,
} from "@replit/codemirror-vim";
import { tags } from "@lezer/highlight";
import type { Settings } from "./settings";

const tomorrowHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "#7285b7" },
  { tag: tags.keyword, color: "#ebbbff" },
  { tag: tags.string, color: "#d1f1a9" },
  { tag: tags.heading, color: "#d1f1a9", fontWeight: "bold" },
  { tag: [tags.number, tags.bool, tags.null], color: "#ffc58f" },
  {
    tag: [
      tags.variableName,
      tags.tagName,
      tags.attributeName,
      tags.propertyName,
    ],
    color: "#ff9da4",
  },
  { tag: [tags.typeName, tags.className], color: "#ffeead" },
  { tag: tags.function(tags.variableName), color: "#bbdaff" },
  { tag: [tags.operator, tags.regexp], color: "#99ffff" },
  { tag: [tags.link, tags.url], color: "#bbdaff", textDecoration: "underline" },
  { tag: tags.strong, color: "#ffeead", fontWeight: "bold" },
  { tag: tags.emphasis, color: "#ebbbff", fontStyle: "italic" },
  { tag: tags.monospace, color: "#ffc58f" },
  { tag: [tags.processingInstruction, tags.meta], color: "#99ffff" },
  { tag: tags.labelName, color: "#ffeead" },
  { tag: tags.quote, color: "#bbdaff", fontStyle: "italic" },
  { tag: tags.contentSeparator, color: "#7285b7" },
  { tag: tags.strikethrough, color: "#9dadce", textDecoration: "line-through" },
  { tag: tags.escape, color: "#99ffff" },
  { tag: tags.inserted, color: "#d1f1a9" },
  { tag: [tags.deleted, tags.invalid], color: "#ff9da4" },
]);

const commands = new WeakMap<
  object,
  {
    save(): Promise<boolean>;
    saveAll(): Promise<boolean>;
    reload(discard: boolean): Promise<boolean>;
    close(): void;
  }
>();
const pendingEx = new WeakMap<object, Promise<boolean>>();
const editorCache = new Map<
  string,
  { json: any; scroll: number; bytes: number }
>();
let lastFocused: EditorView | undefined;
export function sourceView(element: HTMLElement | null) {
  return element ? EditorView.findFromDOM(element) : null;
}
export async function sourceClipboard(
  action: "cut" | "copy" | "paste",
  element: HTMLElement | null,
) {
  const editor = sourceView(element);
  if (!editor) throw new Error("Focus a source editor first");
  const before = editor.state;
  const selection = before.selection.main;
  if (action !== "paste" && selection.empty) return false;
  const text =
    action === "paste"
      ? (await navigator.clipboard.readText()).replace(/\r\n?/g, "\n")
      : before.sliceDoc(selection.from, selection.to);
  if (action !== "paste") await navigator.clipboard.writeText(text);
  if (action !== "copy") {
    if (editor.state !== before)
      throw new Error(
        "The editor changed while accessing the clipboard. Try again.",
      );
    if (before.readOnly) throw new Error("This editor is read-only");
    editor.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: action === "paste" ? text : "",
      },
      selection: {
        anchor: selection.from + (action === "paste" ? text.length : 0),
      },
      userEvent: action === "paste" ? "input.paste" : "delete.cut",
    });
  }
  editor.focus();
  return true;
}
export function editorAction(
  action:
    | "find"
    | "findNext"
    | "findPrevious"
    | "replaceNext"
    | "replaceAll"
    | "closeFind"
    | "undo"
    | "redo"
    | "selectAll"
    | "focus",
  args: {
    search?: string;
    replace?: string;
    caseSensitive?: boolean;
    regexp?: boolean;
  } = {},
) {
  if (!lastFocused) return false;
  lastFocused.focus();
  if (args.search !== undefined)
    lastFocused.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ ...args, search: args.search }),
      ),
    });
  if (action === "findNext") return findNext(lastFocused);
  if (action === "findPrevious") return findPrevious(lastFocused);
  if (action === "replaceNext") return replaceNext(lastFocused);
  if (action === "replaceAll") return replaceAll(lastFocused);
  if (action === "closeFind") return closeSearchPanel(lastFocused);
  return action === "find"
    ? openSearchPanel(lastFocused)
    : action === "undo"
      ? undo(lastFocused)
      : action === "redo"
        ? redo(lastFocused)
        : action === "selectAll"
          ? selectAll(lastFocused)
          : true;
}
function hostEx(
  name: string,
  prefix: string,
  action: (cm: CodeMirrorV, params: ExParams) => Promise<boolean>,
) {
  Vim.defineEx(name, prefix, (cm, params) => {
    const pending = Promise.resolve()
      .then(() => {
        // Never silently reinterpret a filename, range, or shell command as Save.
        if (
          params.line !== undefined ||
          !/^!?$/.test((params.argString || "").trim())
        )
          throw new Error(
            `:${name} supports the current file only, without ranges or filenames.`,
          );
        return action(cm, params);
      })
      .catch((error) => {
        cm.openNotification(
          document.createTextNode(String(error).replace(/^Error: /, "")),
          { bottom: true, duration: 5000 },
        );
        return false;
      });
    pendingEx.set(cm, pending);
  });
}
hostEx("write", "w", async (cm) => commands.get(cm)?.save() ?? false);
hostEx("update", "up", async (cm) => commands.get(cm)?.save() ?? false);
hostEx("wall", "wa", async (cm) => commands.get(cm)?.saveAll() ?? false);
hostEx(
  "edit",
  "e",
  async (cm, params) =>
    commands.get(cm)?.reload((params.argString || "").trim() === "!") ?? false,
);
hostEx("quit", "q", async (cm) => {
  commands.get(cm)?.close();
  return true;
});
for (const [name, prefix] of [
  ["wq", "wq"],
  ["xit", "x"],
  ["exit", "ex"],
])
  hostEx(name, prefix, async (cm) => {
    const actions = commands.get(cm);
    if (!actions || !(await actions.save())) return false;
    actions.close();
    return true;
  });
export async function vimCommand(command: string) {
  const cm = lastFocused && getCM(lastFocused);
  if (!cm?.state.vim)
    throw new Error("Focus a source editor with Vim mode enabled first.");
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 2048 ||
    /[\r\n]/.test(command)
  )
    throw new Error("Provide one Vim Ex command (up to 2,048 characters).");
  pendingEx.delete(cm);
  Vim.handleEx(cm as CodeMirrorV, command.replace(/^:/, ""));
  return pendingEx.get(cm) ?? true;
}

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#002451",
      color: "#ffffff",
      fontSize: "var(--editor-font-size, 13px)",
    },
    ".cm-content": {
      fontFamily:
        'var(--editor-font-family, "Cascadia Code", Consolas, monospace)',
      padding: "var(--space-8) 0",
      caretColor: "#ffffff",
    },
    ".cm-line": { padding: "0 var(--space-16) 0 var(--space-8)" },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "var(--editor-line-height, 1.75)",
      fontFamily:
        'var(--editor-font-family, "Cascadia Code", Consolas, monospace)',
    },
    ".cm-gutters": {
      backgroundColor: "#002451",
      color: "#7285b7",
      border: "none",
      padding: "var(--space-8) 0 0 var(--space-8)",
    },
    ".cm-activeLine": { backgroundColor: "#00346e" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#003f8e",
    },
    ".cm-cursor": { borderLeftColor: "#ffffff" },
    ".cm-panels": { backgroundColor: "#001c40", color: "#ffffff" },
    ".cm-searchMatch": { backgroundColor: "#6e5929" },
  },
  { dark: true },
);
export default function Editor({
  path,
  cacheKey = path,
  value,
  vimMode,
  wordWrap = true,
  fontSettings,
  onChange,
  onSave,
  onSaveAll,
  onReload,
  onClose,
}: {
  path: string;
  cacheKey?: string;
  value: string;
  vimMode: boolean;
  wordWrap?: boolean;
  fontSettings: Settings;
  onChange(value: string): void;
  onSave(): Promise<boolean>;
  onSaveAll(): Promise<boolean>;
  onReload(discard: boolean): Promise<boolean>;
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const vimCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave, onSaveAll, onReload, onClose });
  callbacks.current = { onChange, onSave, onSaveAll, onReload, onClose };
  const syncing = useRef(false);
  useEffect(() => {
    let editor: EditorView;
    const extensions = [
      lineNumbers(),
      history(),
      drawSelection(),
      Prec.highest(
        EditorView.domEventHandlers({
          mousedown(event, view) {
            // A mouse drag always selects, even when starting on selected text.
            // Keep double/triple-click and Shift-click behavior owned by CodeMirror.
            if (event.button === 0 && event.detail === 1 && !event.shiftKey) {
              const at = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              });
              if (at !== null && !view.state.selection.main.empty)
                view.dispatch({
                  selection: { anchor: at },
                  userEvent: "select.pointer",
                });
            }
            return false;
          },
          dragstart(event) {
            event.preventDefault();
            return true;
          },
        }),
      ),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      vimCompartment.current.of(vimMode ? vim({ status: true }) : []),
      // Vim creates view.cm before the shared panel plugin initializes.
      search(),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              void callbacks.current.onSave();
              return true;
            },
          },
        ]),
      ),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      syntaxHighlighting(tomorrowHighlight),
      editorLanguage(path),
      theme,
      wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
      EditorView.domEventHandlers({
        focus: () => {
          lastFocused = editor;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !syncing.current)
          callbacks.current.onChange(update.state.doc.toString());
      }),
    ];
    const cached = editorCache.get(cacheKey);
    const state =
      cached?.json.doc === value
        ? EditorState.fromJSON(
            cached.json,
            { extensions },
            { history: historyField },
          )
        : EditorState.create({ doc: value, extensions });
    editor = new EditorView({ parent: host.current!, state });
    if (cached?.json.doc === value) editor.scrollDOM.scrollTop = cached.scroll;
    view.current = editor;
    lastFocused = editor;
    const cm = getCM(editor);
    if (cm)
      commands.set(cm, {
        save: () => callbacks.current.onSave(),
        saveAll: () => callbacks.current.onSaveAll(),
        reload: (discard) => callbacks.current.onReload(discard),
        close: () => callbacks.current.onClose(),
      });
    return () => {
      const json = editor.state.toJSON({ history: historyField });
      const bytes = JSON.stringify(json).length * 2;
      editorCache.delete(cacheKey);
      if (bytes <= 8 * 1024 * 1024)
        editorCache.set(cacheKey, {
          json,
          bytes,
          scroll: editor.scrollDOM.scrollTop,
        });
      while (
        editorCache.size > 40 ||
        [...editorCache.values()].reduce((sum, item) => sum + item.bytes, 0) >
          20 * 1024 * 1024
      )
        editorCache.delete(editorCache.keys().next().value!);
      if (lastFocused === editor) lastFocused = undefined;
      editor.destroy();
      view.current = undefined;
    };
  }, [path, cacheKey]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: vimCompartment.current.reconfigure(
        vimMode ? vim({ status: true }) : [],
      ),
    });
    const cm = getCM(editor);
    if (cm)
      commands.set(cm, {
        save: () => callbacks.current.onSave(),
        saveAll: () => callbacks.current.onSaveAll(),
        reload: (discard) => callbacks.current.onReload(discard),
        close: () => callbacks.current.onClose(),
      });
  }, [vimMode]);
  useEffect(() => {
    view.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wordWrap]);
  useEffect(() => {
    // CSS changes must also refresh CodeMirror's cursor and line measurements.
    view.current?.requestMeasure();
  }, [
    fontSettings["editor.fontSize"],
    fontSettings["editor.fontFamily"],
    fontSettings["editor.lineHeight"],
  ]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      syncing.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
      syncing.current = false;
    }
  }, [value]);
  return <div className="editor-host" ref={host} />;
}
