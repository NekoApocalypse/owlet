const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const MAX_TEXT = 4 * 1024 * 1024,
  MAX_IMAGE = 16 * 1024 * 1024;
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
const display = (value) => value.replaceAll("\\", "/");
function resolve(value) {
  if (typeof value !== "string" || value.includes("\0"))
    throw new Error("Invalid path");
  if (value === "~" || /^[~][\\/]/.test(value))
    value = os.homedir() + value.slice(1);
  return path.resolve(value);
}
function stat(value) {
  const file = resolve(value),
    info = fs.statSync(file, { bigint: true });
  return {
    path: display(file),
    directory: info.isDirectory(),
    size: Number(info.size),
    stamp: `${info.mtimeNs}:${info.ctimeNs}:${info.size}`,
  };
}
function bytes(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Choose a regular file");
    const buffer = Buffer.alloc(
      Math.min(Number(fs.fstatSync(fd).size), limit) + 1,
    );
    let length = 0,
      count;
    while (
      length < buffer.length &&
      (count = fs.readSync(fd, buffer, length, buffer.length - length, null))
    )
      length += count;
    if (length > limit)
      throw new Error(`File exceeds ${limit / 1024 / 1024} MiB limit`);
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
function save(args) {
  const file = fs.realpathSync(resolve(args.path));
  const original = bytes(file, MAX_TEXT);
  if (digest(original) !== args.revision)
    throw new Error(
      "CONFLICT: The file changed. Compare or reload before saving.",
    );
  if (typeof args.text !== "string") throw new Error("Invalid text");
  const data = Buffer.from(args.text, "utf8");
  if (data.length > MAX_TEXT)
    throw new Error("Text files are limited to 4 MiB");
  const temporary = path.join(
    path.dirname(file),
    `.owlet-save-${crypto.randomUUID()}`,
  );
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", fs.statSync(file).mode);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (digest(bytes(file, MAX_TEXT)) !== args.revision)
      throw new Error("CONFLICT: The file changed during save.");
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { revision: digest(data), stamp: stat(file).stamp };
}
function settings(args, write = false) {
  const root = fs.realpathSync(resolve(args.root));
  if (!fs.statSync(root).isDirectory())
    throw new Error("Project root must be a directory");
  const directory = path.join(root, ".owlet"),
    file = path.join(directory, "settings.json");
  for (const item of [directory, file]) {
    try {
      if (fs.lstatSync(item).isSymbolicLink())
        throw new Error("Project settings must not be symlinks");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let data = {},
    revision = null;
  try {
    const raw = bytes(file, 16384);
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    revision = digest(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!data || Array.isArray(data) || typeof data !== "object")
    throw new Error("Project settings must be a JSON object");
  const validate = (color) => {
    if (
      color != null &&
      (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))
    )
      throw new Error("Use a #RRGGBB color");
  };
  validate(data["peacock.color"]);
  if (write) {
    if (!Object.hasOwn(args, "revision") || revision !== args.revision)
      throw new Error(
        "CONFLICT: Project settings changed. Reload settings before saving.",
      );
    validate(args.color);
    if (args.color == null) delete data["peacock.color"];
    else data["peacock.color"] = args.color.toLowerCase();
    const text = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(text) > 16384)
      throw new Error("Project settings are limited to 16 KiB");
    if (revision !== null) save({ path: file, revision, text });
    else if (args.color != null) {
      fs.mkdirSync(directory, { recursive: true });
      const temporary = path.join(
        directory,
        `.settings-${crypto.randomUUID()}`,
      );
      try {
        fs.writeFileSync(temporary, text, { flag: "wx" });
        fs.linkSync(temporary, file); // Create-if-absent; never overwrite another writer.
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
    return settings(args);
  }
  return {
    path: display(file),
    color: data["peacock.color"] || null,
    revision,
    stamp: revision ? stat(file).stamp : null,
  };
}
function imagePath(args) {
  if (!Object.hasOwn(args, "source")) return resolve(args.path);
  let source = args.source;
  if (typeof source !== "string") throw new Error("Invalid image source");
  // Drive paths are filenames, not URL schemes. Network images are never fetched.
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source))
    throw new Error("Online image URLs are not loaded");
  source = decodeURIComponent(source.split(/[?#]/)[0]);
  const base = path.dirname(resolve(args.document || args.path)),
    root = resolve(args.root || base);
  const candidates = [];
  if (path.isAbsolute(source)) candidates.push(resolve(source));
  else if (/^\.\.?[\\/]/.test(source))
    candidates.push(path.resolve(base, source));
  else {
    candidates.push(path.resolve(base, source));
    const relative = path.relative(root, base);
    if (
      relative === "" ||
      (!relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    ) {
      let parent = base;
      while (parent !== root) {
        const next = path.dirname(parent);
        if (next === parent) break;
        parent = next;
        candidates.push(path.resolve(parent, source));
      }
    } else candidates.push(path.resolve(root, source));
  }
  for (const file of new Set(candidates)) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error("Image not found. Tried: " + candidates.join(" | "));
}
class LocalConnection extends EventEmitter {
  constructor({
    executable = process.execPath,
    appPath,
    packaged = true,
  } = {}) {
    super();
    this.kind = "local";
    this.target = "Local";
    this.terminals = new Map();
    this.files = new (require("./file-operations.cjs").FileOperations)();
    this.state = {
      kind: "local",
      status: "connected",
      target: "Local",
      home: display(os.homedir()),
      shell: process.platform === "win32" ? "PowerShell" : "Shell",
    };
    this.executable = executable;
    this.appPath = appPath;
    this.packaged = packaged;
  }
  async connect() {
    return this.state;
  }
  async request(method, args = {}) {
    if (method === "fs-operation") return this.files.operation(args);
    if (method.startsWith("upload-")) return this.files.transfer(method, args);
    if (method === "stat") return stat(args.path);
    if (method === "stats")
      return args.paths.slice(0, 200).map((file) => {
        try {
          return stat(file);
        } catch (error) {
          return {
            path: file,
            error:
              error.code === "ENOENT"
                ? "No such file or directory"
                : error.message,
          };
        }
      });
    if (method === "save") return save(args);
    if (method === "project-settings" || method === "project-color")
      return settings(args, method === "project-color");
    if (method === "import-peacock") {
      const file = path.join(resolve(args.root), ".vscode", "settings.json");
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes(file, 65536))
        .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) =>
          token.startsWith('"') ? token : " ",
        )
        .replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) =>
          token.startsWith('"') ? token : "",
        );
      const value = JSON.parse(text),
        field = "peacock.color",
        color = value?.[field];
      if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))
        throw new Error(
          "No six-digit peacock.color found in .vscode/settings.json",
        );
      return { color: color.toLowerCase(), field, source: display(file) };
    }
    if (method === "list") {
      const directory = resolve(args.path),
        entries = [];
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const dir = fs.opendirSync(directory);
      let index = 0,
        nextOffset = null;
      try {
        for (let item; (item = dir.readSync());) {
          if (index++ < offset) continue;
          const file = path.join(directory, item.name);
          try {
            // Windows opendir can report a junction as an ordinary directory.
            const symlink =
              item.isSymbolicLink() ||
              (process.platform === "win32" &&
                item.isDirectory() &&
                fs.lstatSync(file).isSymbolicLink());
            entries.push({
              name: item.name,
              path: display(file),
              directory: symlink
                ? fs.statSync(file).isDirectory()
                : item.isDirectory(),
              symlink,
            });
          } catch {
            continue;
          }
          if (entries.length === 101) {
            nextOffset = index - 1;
            break;
          }
        }
      } finally {
        dir.closeSync();
      }
      const more = entries.length > 100;
      entries.length = Math.min(entries.length, 100);
      entries.sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
      return {
        path: display(directory),
        entries,
        next: more ? nextOffset : null,
      };
    }
    if (method === "terminal-start") return this.startTerminal(args);
    throw new Error("Unsupported local operation: " + method);
  }
  async download(args, image = false, pdf = false) {
    const file = image ? imagePath(args) : resolve(args.path),
      before = stat(file);
    const data = bytes(
      file,
      pdf ? 32 * 1024 * 1024 : image ? MAX_IMAGE : MAX_TEXT,
    );
    if (before.stamp !== stat(file).stamp)
      throw new Error("File changed while reading; try again");
    if (pdf) {
      if (
        path.extname(file).toLowerCase() !== ".pdf" ||
        !data.subarray(0, 1024).includes(Buffer.from("%PDF-"))
      )
        throw new Error("This file is not a valid PDF");
      return {
        path: display(file),
        stamp: before.stamp,
        data: data.toString("base64"),
      };
    }
    if (image) {
      const mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".bmp": "image/bmp",
      }[path.extname(file).toLowerCase()];
      if (!mime)
        throw new Error("Unsupported image format (SVG opens as source)");
      return {
        path: display(file),
        stamp: before.stamp,
        url: `data:${mime};base64,${data.toString("base64")}`,
      };
    }
    if (data.includes(0)) throw new Error("This appears to be a binary file");
    return {
      path: display(file),
      stamp: before.stamp,
      revision: digest(data),
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        data,
      ),
    };
  }
  startTerminal(args) {
    const cwd = resolve(args.path);
    if (!fs.statSync(cwd).isDirectory())
      throw new Error("Choose a terminal directory");
    if (!this.bin) {
      this.bin = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-local-"));
      const command = [
        this.executable,
        ...(!this.packaged ? [this.appPath] : []),
      ]
        .map((value) => '"' + value.replaceAll("%", "%%") + '"')
        .join(" ");
      fs.writeFileSync(
        path.join(this.bin, "owlet.cmd"),
        `@echo off\r\nif "%~1"=="" (\r\n  start "" ${command} --local "%CD%"\r\n) else (\r\n  start "" ${command} --local "%~f1"\r\n)\r\n`,
      );
      if (process.platform !== "win32") {
        const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
        fs.writeFileSync(
          path.join(this.bin, "owlet"),
          `#!/bin/sh\nexec ${[this.executable, ...(!this.packaged ? [this.appPath] : [])].map(quote).join(" ")} --local "\${1:-.}"\n`,
          { mode: 0o700 },
        );
      }
    }
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    const pathKey =
      Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
    env[pathKey] = this.bin + path.delimiter + (env[pathKey] || "");
    delete env.ELECTRON_RUN_AS_NODE;
    const pty = require("node-pty");
    const terminal = pty.spawn(
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash",
      process.platform === "win32" ? ["-NoLogo"] : ["-i"],
      {
        name: "xterm-256color",
        useConptyDll: true,
        cwd,
        env,
        cols: Math.max(1, Math.min(1000, args.cols || 80)),
        rows: Math.max(1, Math.min(1000, args.rows || 24)),
      },
    );
    this.terminals.set(args.terminal, terminal);
    terminal.onData((data) =>
      this.emit("remote-event", {
        event: "terminal-data",
        terminal: args.terminal,
        data: Buffer.from(data).toString("base64"),
      }),
    );
    terminal.onExit(({ exitCode }) => {
      this.terminals.delete(args.terminal);
      this.emit("remote-event", {
        event: "terminal-exit",
        terminal: args.terminal,
        status: exitCode,
      });
    });
    return { terminal: args.terminal };
  }
  notify(method, args) {
    const term = this.terminals.get(args.terminal);
    if (!term) return;
    if (method === "terminal-input")
      term.write(Buffer.from(args.data, "base64").toString("utf8"));
    else if (method === "terminal-resize")
      term.resize(
        Math.max(1, Math.min(1000, args.cols)),
        Math.max(1, Math.min(1000, args.rows)),
      );
    else if (method === "terminal-close") term.kill();
  }
  close() {
    this.files.close();
    for (const terminal of this.terminals.values()) terminal.kill();
    this.terminals.clear();
    if (
      this.bin &&
      path.dirname(this.bin) === os.tmpdir() &&
      path.basename(this.bin).startsWith("owlet-local-")
    )
      fs.rmSync(this.bin, { recursive: true, force: true });
    this.bin = null;
  }
}
module.exports = { LocalConnection };
