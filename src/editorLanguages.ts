import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import {
  c,
  cpp,
  java,
  csharp,
  kotlin,
} from "@codemirror/legacy-modes/mode/clike";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { isMarkdown } from "./types";

// Local tokenizers only. Files and fenced blocks share aliases and cached
// parsers; no server, workspace indexing, or completion UI is involved.
const factories: Record<string, () => LanguageSupport> = {
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  python,
  json,
  html,
  css,
  yaml,
  shell: () => new LanguageSupport(StreamLanguage.define(shell)),
  c: () => new LanguageSupport(StreamLanguage.define(c)),
  cpp: () => new LanguageSupport(StreamLanguage.define(cpp)),
  java: () => new LanguageSupport(StreamLanguage.define(java)),
  csharp: () => new LanguageSupport(StreamLanguage.define(csharp)),
  kotlin: () => new LanguageSupport(StreamLanguage.define(kotlin)),
  rust: () => new LanguageSupport(StreamLanguage.define(rust)),
  go: () => new LanguageSupport(StreamLanguage.define(go)),
  sql: () => new LanguageSupport(StreamLanguage.define(standardSQL)),
  toml: () => new LanguageSupport(StreamLanguage.define(toml)),
  dockerfile: () => new LanguageSupport(StreamLanguage.define(dockerFile)),
  powershell: () => new LanguageSupport(StreamLanguage.define(powerShell)),
  diff: () => new LanguageSupport(StreamLanguage.define(diff)),
};
const aliases: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  py: "python",
  pyw: "python",
  python: "python",
  python3: "python",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  shellscript: "shell",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  "c++": "cpp",
  java: "java",
  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",
  kt: "kotlin",
  kts: "kotlin",
  kotlin: "kotlin",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  sql: "sql",
  toml: "toml",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  powershell: "powershell",
  pwsh: "powershell",
  diff: "diff",
  patch: "diff",
};
const cache = new Map<string, LanguageSupport>();
function codeLanguage(name: string) {
  const alias = name.toLowerCase();
  if (!Object.hasOwn(aliases, alias)) return null;
  const key = aliases[alias];
  if (!cache.has(key)) cache.set(key, factories[key]());
  return cache.get(key)!;
}
let markdownSupport: LanguageSupport | undefined;
export function editorLanguage(path: string) {
  if (isMarkdown(path)) {
    return (markdownSupport ??= markdown({
      base: markdownLanguage,
      completeHTMLTags: false,
      codeLanguages: (info) =>
        codeLanguage(info.trim().split(/\s+/)[0])?.language ?? null,
    }));
  }
  const filename = path.replaceAll("\\", "/").split("/").pop()!.toLowerCase();
  if (/^(dockerfile|containerfile)(\.|$)/.test(filename))
    return codeLanguage("dockerfile")!;
  if (
    /^\.(bashrc|bash_profile|bash_login|zshrc|zprofile|profile)$/.test(filename)
  )
    return codeLanguage("shell")!;
  return codeLanguage(filename.split(".").pop()!) ?? [];
}
