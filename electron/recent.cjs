const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Only workspace locations live here. Credentials remain in OpenSSH.
class RecentWorkspaces {
  constructor(file) {
    this.file = file;
    this.entries = [];
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(saved)) {
        const seen = new Set();
        this.entries = saved
          .flatMap((item) => {
            try {
              const entry = this.normalize(item);
              if (seen.has(entry.id)) return [];
              seen.add(entry.id);
              return [entry];
            } catch {
              return [];
            }
          })
          .slice(0, 50);
      }
    } catch {
      /* A missing or damaged history must not block startup. */
    }
  }
  normalize(item) {
    if (
      !item ||
      !["local", "ssh"].includes(item.kind) ||
      typeof item.path !== "string" ||
      !item.path ||
      item.path.includes("\0") ||
      (item.kind === "ssh" &&
        (typeof item.target !== "string" ||
          !item.target ||
          item.target.includes("\0")))
    )
      throw new Error("Invalid recent workspace");
    const location =
      item.kind === "local"
        ? path.resolve(item.path).replaceAll("\\", "/")
        : path.posix.normalize(item.path).replace(/\/+$/, "") || "/";
    const target = item.kind === "ssh" ? item.target : undefined;
    const key = JSON.stringify([
      item.kind,
      target,
      item.kind === "local" && process.platform === "win32"
        ? location.toLowerCase()
        : location,
    ]);
    return {
      id: createHash("sha256").update(key).digest("hex"),
      kind: item.kind,
      path: location,
      ...(target ? { target } : {}),
    };
  }
  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
  save(entries) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2));
    fs.renameSync(temporary, this.file);
    this.entries = entries;
    return this.list();
  }
  remember(workspace) {
    const entry = this.normalize(workspace);
    return this.save(
      [entry, ...this.entries.filter((item) => item.id !== entry.id)].slice(
        0,
        50,
      ),
    );
  }
  remove(id) {
    return this.save(this.entries.filter((entry) => entry.id !== id));
  }
  clear() {
    return this.save([]);
  }
}
module.exports = { RecentWorkspaces };
