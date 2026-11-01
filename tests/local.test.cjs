const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { LocalConnection } = require("../electron/local.cjs");
const normalize = (p) => p.replaceAll("\\", "/");
test("local files, Unicode, bounded reads, revision conflicts and settings", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-local-test-"));
  t.after(() => {
    if (
      path.dirname(root) === os.tmpdir() &&
      path.basename(root).startsWith("owlet-local-test-")
    )
      fs.rmSync(root, { recursive: true, force: true });
  });
  const local = new LocalConnection();
  assert.equal((await local.connect()).kind, "local");
  const file = path.join(root, "方案 with spaces.md");
  fs.writeFileSync(file, "# Plan\r\nαβ\r\n");
  const opened = await local.download({ path: file });
  assert.equal(opened.text, "# Plan\r\nαβ\r\n");
  assert.equal(opened.path, normalize(file));
  const saved = await local.request("save", {
    path: file,
    text: "# Updated\r\n",
    revision: opened.revision,
  });
  assert.notEqual(saved.revision, opened.revision);
  await assert.rejects(
    local.request("save", {
      path: file,
      text: "lost",
      revision: opened.revision,
    }),
    /CONFLICT/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "# Updated\r\n");
  fs.writeFileSync(path.join(root, "binary"), Buffer.from([0, 1]));
  await assert.rejects(
    local.download({ path: path.join(root, "binary") }),
    /binary/,
  );
  fs.writeFileSync(path.join(root, "invalid"), Buffer.from([0xff]));
  await assert.rejects(local.download({ path: path.join(root, "invalid") }));
  fs.writeFileSync(
    path.join(root, "large.txt"),
    Buffer.alloc(4 * 1024 * 1024 + 1, 65),
  );
  await assert.rejects(
    local.download({ path: path.join(root, "large.txt") }),
    /limit/,
  );
  const missing = await local.request("stats", {
    paths: [path.join(root, "absent")],
  });
  assert.match(missing[0].error, /No such file/);
  const initial = await local.request("project-settings", { root });
  assert.equal(initial.revision, null);
  assert.equal(fs.existsSync(path.join(root, ".owlet")), false);
  const set = await local.request("project-color", {
    root,
    color: "#fa9af4",
    revision: null,
  });
  assert.equal(set.color, "#fa9af4");
  await assert.rejects(
    local.request("project-color", { root, color: "#123456", revision: null }),
    /CONFLICT/,
  );
  const config = path.join(root, ".owlet/settings.json");
  fs.writeFileSync(
    config,
    JSON.stringify({ "peacock.color": "#123456", custom: 42 }),
  );
  const current = await local.request("project-settings", { root });
  await local.request("project-color", {
    root,
    color: "#abcdef",
    revision: current.revision,
  });
  assert.equal(JSON.parse(fs.readFileSync(config)).custom, 42);
  fs.mkdirSync(path.join(root, ".vscode"));
  fs.writeFileSync(
    path.join(root, ".vscode/settings.json"),
    '{// example\n"peacock.color":"#112233","peacock.remoteColor":"#445566","url":"https://example.com",}',
  );
  assert.equal(
    (await local.request("import-peacock", { root })).color,
    "#112233",
  );
  assert.equal(
    (await local.request("project-settings", { root })).color,
    "#abcdef",
  );
  fs.writeFileSync(config, "{ invalid");
  await assert.rejects(
    local.request("project-color", { root, color: "#123456", revision: null }),
  );
  assert.equal(fs.readFileSync(config, "utf8"), "{ invalid");
});
test("local image resolution chooses nearest ancestor, honors explicit paths and rejects URLs", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-images-test-"));
  t.after(() => {
    if (
      path.dirname(root) === os.tmpdir() &&
      path.basename(root).startsWith("owlet-images-test-")
    )
      fs.rmSync(root, { recursive: true, force: true });
  });
  const local = new LocalConnection();
  fs.mkdirSync(path.join(root, "docs/topic"), { recursive: true });
  fs.mkdirSync(path.join(root, "images"));
  fs.writeFileSync(path.join(root, "images/a b.png"), Buffer.from("root"));
  fs.writeFileSync(path.join(root, "docs/a.png"), Buffer.from("near"));
  fs.writeFileSync(path.join(root, "a.png"), Buffer.from("far"));
  const args = { root, document: path.join(root, "docs/topic/plan.md") };
  assert.equal(
    (await local.download({ ...args, source: "images/a%20b.png" }, true)).path,
    normalize(path.join(root, "images/a b.png")),
  );
  assert.equal(
    (await local.download({ ...args, source: "a.png" }, true)).path,
    normalize(path.join(root, "docs/a.png")),
  );
  await assert.rejects(
    local.download({ ...args, source: "./a.png" }, true),
    /not found/,
  );
  await assert.rejects(
    local.download({ ...args, source: "https://example.com/a.png" }, true),
    /not loaded/,
  );
});
test("directory pages preserve all entries", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-pages-test-"));
  t.after(() => {
    if (
      path.dirname(root) === os.tmpdir() &&
      path.basename(root).startsWith("owlet-pages-test-")
    )
      fs.rmSync(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 225; i++)
    fs.writeFileSync(path.join(root, `${i}.md`), "");
  fs.symlinkSync(
    path.join(root, "missing"),
    path.join(root, "000-broken"),
    "junction",
  );
  const local = new LocalConnection(),
    entries = [];
  let next = 0;
  do {
    const page = await local.request("list", { path: root, offset: next });
    entries.push(...page.entries);
    next = page.next;
  } while (next !== null);
  assert.equal(new Set(entries.map((e) => e.path)).size, 225);
  assert.equal(
    entries.length,
    225,
    "Skipped broken links must not duplicate entries on later pages",
  );
});
