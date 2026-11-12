const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.resolve(root, "release/Owlet-source");
if (path.dirname(output) !== path.join(root, "release"))
  throw new Error("Invalid export directory");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const files = [];
function copy(relative) {
  const from = path.join(root, relative),
    to = path.join(output, relative);
  if (fs.lstatSync(from).isSymbolicLink())
    throw new Error("Do not export symlinks: " + relative);
  if (fs.statSync(from).isDirectory()) {
    for (const name of fs.readdirSync(from)) copy(path.join(relative, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files.push(relative.replaceAll("\\", "/"));
}
for (const entry of [
  "README.md",
  "AGENTS.md",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "src",
  "electron",
  "remote",
  "examples",
  "tests",
  "docs/usage.md",
  "docs/commands.md",
  "docs/development.md",
  "docs/spacing.md",
  "docs/performance.md",
  "docs/images",
  "scripts/dev.cjs",
  "scripts/package.cjs",
  "scripts/install-shortcuts.cjs",
  "scripts/generate-icon.cjs",
  "scripts/export-source.cjs",
  "assets/icon.png",
  "assets/LICENSE.lucide.txt",
  "assets/LICENSE.ripgrep.txt",
  "assets/icon.ico",
  "assets/icon-manifest.json",
  "assets/" + require("../assets/icon-manifest.json").icon,
  "assets/concepts/owlet-selected-original.png",
  "assets/concepts/owlet-selected-transparent.png",
  "assets/concepts/owlet-selected-transparent.prompt.json",
])
  copy(entry);
if (fs.existsSync(path.join(root, "LICENSE"))) copy("LICENSE");
const archive = path.join(root, "release/Owlet-source.zip");
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const command = `Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(archive)} -Force`;
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(command, "utf16le").toString("base64"),
  ],
  { windowsHide: true, stdio: "inherit" },
);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts/source-export.json"),
  JSON.stringify(
    {
      archive,
      files,
      licenseSelected: fs.existsSync(path.join(root, "LICENSE")),
      published: false,
    },
    null,
    2,
  ),
);
console.log(`Exported ${files.length} files to ${archive}`);
