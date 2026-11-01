const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Connection } = require("../electron/connection.cjs");
const { python } = require("./fixture.cjs");
const connection = new Connection(require("./fixture.cjs").target);
let root;
before(async () => {
  root = python(
    `import tempfile; print(tempfile.mkdtemp(prefix='lwr-settings-test-', dir=${JSON.stringify(require("./fixture.cjs").temporaryRoot)}))`,
  );
  await connection.connect();
});
after(() => connection.close());
const get = () => connection.request("project-settings", { root });
const set = (color, revision) =>
  connection.request("project-color", { root, color, revision });
const read = () =>
  connection.download({ path: root + "/.owlet/settings.json" });
async function write(text) {
  const current = await read();
  return connection.request("save", {
    path: current.path,
    text,
    revision: current.revision,
  });
}
test("reading an unconfigured project creates nothing", async () => {
  assert.equal((await get()).revision, null);
  assert.equal(
    (await connection.request("list", { path: root })).entries.length,
    0,
  );
});
test("one color key drives settings, preserving unrelated keys and detecting stale writers", async () => {
  const initial = await set("#fa9af4", null);
  assert.deepEqual(JSON.parse((await read()).text), {
    "peacock.color": "#fa9af4",
  });
  await write(
    JSON.stringify({ "peacock.color": "#fa9af4", custom: { keep: true } }),
  );
  await assert.rejects(set("#355c7d", initial.revision), /CONFLICT/);
  const current = await get();
  await set("#355C7D", current.revision);
  assert.deepEqual(JSON.parse((await read()).text), {
    "peacock.color": "#355c7d",
    custom: { keep: true },
  });
  await set(null, (await get()).revision);
  assert.deepEqual(JSON.parse((await read()).text), { custom: { keep: true } });
});
test("malformed settings and invalid colors never overwrite the file", async () => {
  await assert.rejects(set("red", (await get()).revision), /RRGGBB/);
  await write('{"peacock.color": ');
  await assert.rejects(get());
  await assert.rejects(set("#fa9af4", null));
  assert.equal((await read()).text, '{"peacock.color": ');
  await write("{}");
});
test("explicit import reads JSONC remoteColor, preserves string contents and never changes VS Code", async () => {
  const jsonc =
    '{\n// User choice\n"url":"https://example.com/a/*b*/",\n"peacock.color":"#355c7d",\n"peacock.remoteColor":"#FA9AF4", /* remote wins */\n}';
  python(
    `import os\np=${JSON.stringify(root)}\nos.makedirs(p+'/.vscode')\nopen(p+'/.vscode/settings.json','w').write(${JSON.stringify(jsonc)})`,
  );
  assert.equal(
    (await get()).color,
    null,
    "Normal settings reads ignore VS Code",
  );
  const imported = await connection.request("import-peacock", { root });
  assert.equal(imported.color, "#fa9af4");
  assert.equal(imported.field, "peacock.remoteColor");
  assert.equal(
    (await get()).color,
    null,
    "Reading the import candidate does not save it",
  );
  assert.equal(
    (await connection.download({ path: root + "/.vscode/settings.json" })).text,
    jsonc,
  );
});
test("settings symlinks are refused and settings payloads are bounded", async () => {
  const other = python(
    `import os\np=${JSON.stringify(root)}+'/other'\nos.mkdir(p)\nos.symlink(${JSON.stringify(root)}+'/.owlet',p+'/.owlet')\nprint(p)`,
  );
  await assert.rejects(
    connection.request("project-settings", { root: other }),
    /symlinks/,
  );
  await write(JSON.stringify({ extra: "x".repeat(17000) }));
  await assert.rejects(get(), /16 KiB/);
});
