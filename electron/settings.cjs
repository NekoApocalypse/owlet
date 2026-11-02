const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parse, printParseErrorCode } = require("jsonc-parser");
const schema = require("./settings-schema.json");

function validate(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 65536)
    throw new Error("Settings must be text smaller than 64 KiB.");
  const errors = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length)
    throw new Error(
      `Invalid settings JSON: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`,
    );
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Settings must be a JSON object.");
  for (const [key, definition] of Object.entries(schema)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (
      typeof value !== typeof definition.default ||
      (typeof value === "number" &&
        (!Number.isFinite(value) ||
          value < definition.min ||
          value > definition.max ||
          (!definition.step && !Number.isInteger(value)))) ||
      (typeof value === "string" && (!value.trim() || value.length > 256)) ||
      (definition.enum && !definition.enum.includes(value))
    )
      throw new Error(`Invalid value for ${key}.`);
  }
  return data;
}

class UserSettings {
  constructor(file) {
    this.file = file;
  }
  read() {
    let text = "{\n}\n",
      revision = "missing";
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
        throw new Error("Settings must be a regular file smaller than 64 KiB.");
      text = fs.readFileSync(this.file, "utf8");
      revision = crypto.createHash("sha256").update(text).digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { path: this.file, text, revision, stamp: revision };
  }
  save(args) {
    validate(args?.text);
    if (
      typeof args.revision !== "string" ||
      this.read().revision !== args.revision
    )
      throw new Error(
        "CONFLICT: Settings changed on disk. Compare before saving.",
      );
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + "." + crypto.randomUUID() + ".tmp";
    try {
      const fd = fs.openSync(temp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, args.text, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (this.read().revision !== args.revision)
        throw new Error(
          "CONFLICT: Settings changed on disk. Compare before saving.",
        );
      fs.renameSync(temp, this.file);
      return this.read();
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
}
module.exports = { UserSettings, validate };
