const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const valid = (id) =>
  typeof id === "string" && /^[a-zA-Z][\w.-]{0,119}$/.test(id);
class CommandHistory {
  constructor(file) {
    this.file = file;
  }
  list() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(value)
        ? [...new Set(value.filter(valid))].slice(0, 100)
        : [];
    } catch {
      return [];
    }
  }
  save(ids) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(ids));
      fs.renameSync(temp, this.file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return ids;
  }
  remember(id) {
    if (!valid(id)) throw new Error("Invalid command ID");
    return this.save(
      [id, ...this.list().filter((item) => item !== id)].slice(0, 100),
    );
  }
  clear() {
    return this.save([]);
  }
}
module.exports = { CommandHistory };
