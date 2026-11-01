const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { RecentWorkspaces } = require("../electron/recent.cjs");
test("recent workspaces persist, deduplicate, distinguish hosts, and cap history", () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "owlet-recent-")),
    "recent.json",
  );
  const store = new RecentWorkspaces(file);
  store.remember({ kind: "local", path: process.cwd() });
  store.remember({ kind: "ssh", target: "host-a", path: "/work/app" });
  store.remember({ kind: "ssh", target: "host-b", path: "/work/app" });
  store.remember({ kind: "ssh", target: "host-a", path: "/work/./app/" });
  assert.equal(store.list().length, 3);
  assert.equal(store.list()[0].target, "host-a");
  assert.deepEqual(new RecentWorkspaces(file).list(), store.list());
  const id = store.list()[0].id;
  store.remove(id);
  assert.equal(store.list().length, 2);
  assert.ok(fs.existsSync(process.cwd()));
  for (let i = 0; i < 60; i++)
    store.remember({ kind: "ssh", target: "host-a", path: `/work/${i}` });
  assert.equal(store.list().length, 50);
  store.clear();
  assert.deepEqual(new RecentWorkspaces(file).list(), []);
  fs.writeFileSync(file, "{damaged");
  assert.deepEqual(new RecentWorkspaces(file).list(), []);
  assert.throws(() => store.remember({ kind: "ssh", path: "/work" }));
});
