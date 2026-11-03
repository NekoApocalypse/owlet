import {
  BookOpen,
  BookMarked,
  Braces,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  FileAudio,
  Globe,
  Sigma,
  type LucideIcon,
} from "lucide-react";

// Lucide's line icons match the rest of Owlet. Shape + a restrained accent
// distinguish types without requiring color perception or vendor trademarks.
export function fileKind(path: string): [string, LucideIcon, string] {
  const name = path.replaceAll("\\", "/").split("/").pop()!.toLowerCase();
  const ext = name.split(".").pop();
  if (/^(dockerfile|containerfile)(\.|$)/.test(name))
    return ["Container", FileCog, "#9dadce"];
  if (/^(package-lock|package|tsconfig)\.json$/.test(name))
    return ["JSON", FileJson, "#ffeead"];
  if (/^(makefile|cmakelists\.txt)$/.test(name))
    return ["Build", FileCog, "#9dadce"];
  const types: Array<[RegExp, string, LucideIcon, string]> = [
    [/^(pdf)$/, "PDF", FileType, "#ff9d9d"],
    [/^(md|markdown|mdown)$/, "Markdown", BookOpen, "#bbdaff"],
    [
      /^(tex|ltx|latex|sty|cls|dtx|ins|bbx|cbx|lbx)$/,
      "LaTeX",
      Sigma,
      "#a8d5ba",
    ],
    [/^(bib|bst)$/, "Bibliography", BookMarked, "#a8d5ba"],
    [/^(html?|svg|xml)$/, "Markup", Globe, "#ffb986"],
    [/^(png|jpe?g|gif|webp|avif|bmp|ico)$/, "Image", FileImage, "#ebbbff"],
    [/^(jsonc?)$/, "JSON", FileJson, "#ffeead"],
    [/^(css|scss|sass|less)$/, "Stylesheet", Braces, "#bbdaff"],
    [
      /^(ya?ml|toml|ini|conf|config|env|properties)$/,
      "Config",
      FileCog,
      "#9dadce",
    ],
    [/^(csv|tsv|xlsx?|ods)$/, "Table", FileSpreadsheet, "#a8d5ba"],
    [/^(sh|bash|zsh|fish|ps1|psm1|bat|cmd)$/, "Shell", FileTerminal, "#a8d5ba"],
    [/^(zip|gz|bz2|xz|tar|7z|rar)$/, "Archive", FileArchive, "#ffeead"],
    [/^(mp4|webm|mov|avi|mkv)$/, "Video", FileVideo, "#ebbbff"],
    [/^(mp3|wav|ogg|flac|m4a)$/, "Audio", FileAudio, "#ebbbff"],
    [
      /^(js|jsx|ts|tsx|mjs|cjs|py|rs|go|c|h|cpp|hpp|java|cs|kt|sql|r|rb|php|lua|swift)$/,
      "Code",
      FileCode,
      "#bbdaff",
    ],
    [/^(txt|log|rst|adoc)$/, "Text", FileText, "#9dadce"],
  ];
  const found = types.find(([pattern]) => pattern.test(ext || ""));
  return found ? [found[1], found[2], found[3]] : ["File", File, "#9dadce"];
}
export function FileIcon({ path, size = 15 }: { path: string; size?: number }) {
  const [kind, Icon, color] = fileKind(path);
  return (
    <Icon
      size={size}
      style={{ color }}
      data-file-kind={kind}
      aria-hidden="true"
    />
  );
}
