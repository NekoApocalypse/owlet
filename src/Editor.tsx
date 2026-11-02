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
  StreamLanguage,
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
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { tags } from "@lezer/highlight";
import type { Settings } from "./settings";

const tomorrowHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "#7285b7" },
  { tag: tags.keyword, color: "#ebbbff" },
  { tag: [tags.string, tags.heading], color: "#d1f1a9" },
  { tag: [tags.number, tags.bool, tags.null], color: "#ffc58f" },
  {
    tag: [tags.variableName, tags.tagName, tags.attributeName],
    color: "#ff9da4",
  },
  { tag: [tags.typeName, tags.className], color: "#ffeead" },
  { tag: tags.function(tags.variableName), color: "#bbdaff" },
  { tag: [tags.operator, tags.regexp], color: "#99ffff" },
  { tag: tags.link, color: "#bbdaff", textDecoration: "underline" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
]);

const commands = new WeakMap<
  object,
  { save(): Promise<boolean>; close(): void }
>();
const editorCache = new Map<
  string,
  { json: any; scroll: number; bytes: number }
>();
let lastFocused: EditorView | undefined;
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
Vim.defineEx("write", "w", (cm) => {
  void commands.get(cm)?.save();
});
Vim.defineEx("quit", "q", (cm) => {
  commands.get(cm)?.close();
});
Vim.defineEx("wq", "wq", (cm) => {
  const actions = commands.get(cm);
  if (actions)
    void actions.save().then((saved) => {
      if (saved) actions.close();
    });
});

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
function language(path: string) {
  if (/\.(md|markdown)$/.test(path)) return markdown();
  if (/\.[cm]?[jt]sx?$/.test(path))
    return javascript({
      typescript: /\.tsx?$/.test(path),
      jsx: /x$/.test(path),
    });
  if (/\.py$/.test(path)) return python();
  if (/\.json$/.test(path)) return json();
  if (/\.html?$/.test(path)) return html();
  if (/\.css$/.test(path)) return css();
  if (/\.ya?ml$/.test(path)) return yaml();
  if (/\.(sh|bash)$/.test(path) || /\/(\.bashrc|\.bash_profile)$/.test(path))
    return StreamLanguage.define(shell);
  return [];
}
export default function Editor({
  path,
  cacheKey = path,
  value,
  vimMode,
  wordWrap = true,
  fontSettings,
  onChange,
  onSave,
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
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const vimCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave, onClose });
  callbacks.current = { onChange, onSave, onClose };
  const syncing = useRef(false);
  useEffect(() => {
    let editor: EditorView;
    const extensions = [
      lineNumbers(),
      history(),
      drawSelection(),
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
      language(path),
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
