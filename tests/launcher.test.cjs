const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { relaunchExecutable } = require("../electron/launcher.cjs");
test("optional portable launcher requires an existing absolute executable path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-launcher-"));
  try {
    const exe = path.join(root, "Owlet launcher.exe");
    fs.writeFileSync(exe, "fixture");
    assert.equal(relaunchExecutable(exe, "fallback"), exe);
    for (const candidate of [
      undefined,
      "Owlet.exe",
      path.join(root, "missing.exe"),
      root,
      exe + '"',
      exe + "\n",
    ])
      assert.equal(relaunchExecutable(candidate, "fallback"), "fallback");
    fs.mkdirSync(path.join(root, "folder.exe"));
    assert.equal(
      relaunchExecutable(path.join(root, "folder.exe"), "fallback"),
      "fallback",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
