const fs = require("node:fs");
const path = require("node:path");

// A locally managed portable installation can keep its taskbar entry stable
// while running immutable versioned builds. Ordinary packages use their own exe.
function relaunchExecutable(candidate, fallback = process.execPath) {
  if (
    typeof candidate === "string" &&
    path.isAbsolute(candidate) &&
    path.extname(candidate).toLowerCase() === ".exe" &&
    !/["\r\n]/.test(candidate)
  ) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return fallback;
}
module.exports = { relaunchExecutable };
