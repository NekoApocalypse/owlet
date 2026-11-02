const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const display = (value) => value.replaceAll("\\", "/");
const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
};
function scoped(root, file, allowRoot = false) {
  if (
    typeof root !== "string" ||
    typeof file !== "string" ||
    !path.isAbsolute(root) ||
    !path.isAbsolute(file) ||
    file.includes("\0")
  )
    throw Error("Choose an absolute workspace path.");
  const base = fs.realpathSync(root),
    target = path.resolve(file);
  if (
    !within(path.resolve(root), target) ||
    (!allowRoot && target === path.resolve(root))
  )
    throw Error(
      "Choose an item inside the workspace; the root cannot be changed.",
    );
  const parent = fs.realpathSync(allowRoot ? target : path.dirname(target));
  if (!within(base, parent))
    throw Error("This path leaves the workspace through a symbolic link.");
  return target;
}
function named(directory, name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name === "." ||
    name === ".." ||
    /[\\/\0]/.test(name) ||
    name.length > 255
  )
    throw Error("Enter a single file or folder name.");
  return path.join(directory, name);
}
function info(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return {
    path: display(file),
    directory: stat.isDirectory(),
    symlink: stat.isSymbolicLink(),
    revision: `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`,
    size: Number(stat.size),
  };
}
function absent(file) {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw Error("Destination already exists. Choose another name.");
}
async function moveNoReplace(source, destination, directory) {
  if (process.platform !== "win32")
    throw Error(
      "Local moves are currently supported on Windows; SSH moves work on Linux.",
    );
  // .NET's non-overwriting move avoids Node rename's overwrite semantics.
  // Paths travel as JSON over stdin, never as interpolated shell code.
  const script =
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { $move = [Console]::In.ReadToEnd() | ConvertFrom-Json; if ($move.directory) { [IO.Directory]::Move($move.source,$move.destination) } else { [IO.File]::Move($move.source,$move.destination) } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  await new Promise((resolve, reject) => {
    const child = require("node:child_process").spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error(error.trim() || "Move failed")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        source: source,
        destination,
        directory: directory,
      }),
    );
  });
}
async function copyTree(source, destination, budget = { count: 0 }) {
  if (++budget.count > 20000)
    throw Error("Copy is limited to 20,000 files and folders at a time.");
  const before = info(source);
  if (before.symlink)
    throw Error("Copying symbolic links is not supported yet.");
  if (before.directory) {
    await fs.promises.mkdir(destination);
    for (const name of await fs.promises.readdir(source))
      await copyTree(
        path.join(source, name),
        path.join(destination, name),
        budget,
      );
  } else {
    if (!(await fs.promises.stat(source)).isFile())
      throw Error("Copy regular files and folders only.");
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  }
  if (info(source).revision !== before.revision)
    throw Error("Source changed during copy; retry.");
}
class FileOperations {
  constructor() {
    this.uploads = new Map();
    this.downloads = new Map();
  }
  async operation(args) {
    if (args.op === "create-file" || args.op === "create-folder") {
      const directory = scoped(args.root, args.directory, true),
        file = named(directory, args.name);
      if (args.op === "create-folder") fs.mkdirSync(file);
      else {
        const fd = fs.openSync(file, "wx", 0o644);
        fs.closeSync(fd);
      }
      return info(file);
    }
    const file = scoped(args.root, args.path),
      current = info(file);
    if (args.op === "inspect") return current;
    if (args.revision !== current.revision)
      throw Error("The selected item changed. Review the action again.");
    if (args.op === "copy") {
      const destination = scoped(args.root, args.destination);
      if (within(file, destination))
        throw Error("A folder cannot be copied into itself.");
      absent(destination);
      const staging = await fs.promises.mkdtemp(
        path.join(path.dirname(destination), ".owlet-copy-"),
      );
      try {
        const copied = path.join(staging, "content");
        await copyTree(file, copied);
        await moveNoReplace(copied, destination, current.directory);
        return info(destination);
      } finally {
        // staging is a freshly-created absolute child of the checked destination parent.
        if (
          path.dirname(staging) !== path.dirname(destination) ||
          !path.basename(staging).startsWith(".owlet-copy-")
        )
          throw Error("Invalid copy staging path");
        await fs.promises.rm(staging, { recursive: true, force: true });
      }
    }
    if (args.op === "delete") {
      if (current.directory && !current.symlink)
        await fs.promises.rm(file, { recursive: true });
      else await fs.promises.unlink(file);
      return { path: display(file) };
    }
    if (args.op === "move") {
      const destination = scoped(args.root, args.destination);
      if (within(file, destination))
        throw Error("A folder cannot be moved into itself.");
      absent(destination);
      if (current.symlink)
        throw Error("Moving symbolic links is not supported yet.");
      await moveNoReplace(file, destination, current.directory);
      return { ...info(destination), previous: display(file) };
    }
    throw Error("Unsupported file action.");
  }
  transfer(method, args) {
    if (method === "upload-start") {
      if (this.uploads.size >= 4)
        throw Error("Too many transfers. Wait for one to finish.");
      if (!Number.isSafeInteger(args.size) || args.size < 0)
        throw Error("Invalid file size.");
      const directory = scoped(args.root, args.directory, true),
        destination = named(directory, args.name);
      absent(destination);
      const token = crypto.randomUUID(),
        temp = path.join(directory, ".owlet-upload-" + token);
      const fd = fs.openSync(temp, "wx", 0o644);
      this.uploads.set(token, {
        fd,
        temp,
        destination,
        size: args.size,
        offset: 0,
      });
      return { token };
    }
    if (method.startsWith("upload-")) {
      const item = this.uploads.get(args.token);
      if (!item) throw Error("Upload session is no longer available.");
      if (method === "upload-chunk") {
        const data = Buffer.from(args.data, "base64");
        if (
          args.offset !== item.offset ||
          data.length > 16384 ||
          item.offset + data.length > item.size
        )
          throw Error("Invalid upload chunk.");
        let written = 0;
        while (written < data.length)
          written += fs.writeSync(
            item.fd,
            data,
            written,
            data.length - written,
          );
        item.offset += data.length;
        return { offset: item.offset };
      }
      try {
        if (method === "upload-finish") {
          if (item.offset !== item.size) throw Error("Incomplete upload.");
          fs.fsyncSync(item.fd);
          fs.linkSync(item.temp, item.destination);
          return { path: display(item.destination) };
        }
        if (method !== "upload-abort") throw Error("Unknown transfer action.");
      } finally {
        fs.closeSync(item.fd);
        fs.unlinkSync(item.temp);
        this.uploads.delete(args.token);
      }
      return null;
    }
    throw Error("Unsupported transfer action.");
  }
  close() {
    for (const token of this.uploads.keys()) {
      try {
        this.transfer("upload-abort", { token });
      } catch {}
    }
  }
}
module.exports = { FileOperations, scoped, info };
