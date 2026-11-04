const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { CommandHistory } = require("../electron/command-history.cjs");
const { validateWindowState } = require("../electron/window-state.cjs");
const state = () => ({
  version: 1,
  layout: { kind: "group", group: { id: 1, tabs: ["/a.md"], active: "/a.md" } },
  activeGroup: 1,
  modes: { "/a.md": "preview" },
  viewModes: { "1:/a.md": "both" },
  previewRatios: { "1:/a.md": 0.4 },
  previewZoom: 1,
  sidebar: true,
  sidebarWidth: 252,
  terminalVisible: false,
  terminalHeight: 220,
  terminals: [],
  terminalSerial: 0,
});
test("Reload metadata preserves layout but strips buffers and rejects malformed targets", () => {
  const s = state();
  s.text = "private unsaved content";
  s.modes["/closed.md"] = "source";
  const restored = validateWindowState(s);
  assert.equal(restored.text, undefined);
  assert.equal(restored.modes["/closed.md"], undefined);
  assert.equal(restored.viewModes["1:/a.md"], "both");
  for (const mutate of [
    (s) => (s.layout.group.active = "/missing"),
    (s) => (s.layout.group.tabs = [9]),
    (s) => (s.activeGroup = 2),
    (s) => (s.previewZoom = Infinity),
    (s) => (s.previewRatios["1:/a.md"] = 5),
    (s) => (s.modes["/a.md"] = "invalid"),
    (s) => s.layout.group.tabs.push("owlet-terminal:missing"),
  ]) {
    const bad = state();
    mutate(bad);
    assert.throws(() => validateWindowState(bad));
  }
  const nested = state();
  nested.layout = {
    kind: "split",
    id: 1,
    axis: "row",
    ratio: 0.5,
    first: nested.layout,
    second: structuredClone(nested.layout),
  };
  assert.throws(() => validateWindowState(nested));
});
test("Palette history is persistent, unique, bounded and merges new records from other instances", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-history-"));
  try {
    const file = path.join(dir, "commands.json"),
      a = new CommandHistory(file),
      b = new CommandHistory(file);
    assert.deepEqual(a.list(), []);
    a.remember("file.open");
    b.remember("settings.open");
    a.remember("file.open");
    assert.deepEqual(new CommandHistory(file).list(), [
      "file.open",
      "settings.open",
    ]);
    for (let i = 0; i < 120; i++) a.remember("command." + i);
    assert.equal(a.list().length, 100);
    assert.equal(a.list()[0], "command.119");
    assert.throws(() => a.remember({ id: "bad" }));
    a.clear();
    assert.deepEqual(b.list(), []);
    fs.writeFileSync(file, "broken");
    assert.deepEqual(a.list(), []);
    a.remember("window.reload");
    assert.deepEqual(b.list(), ["window.reload"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
