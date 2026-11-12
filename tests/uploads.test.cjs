const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { UploadQueue } = require("../electron/uploads.cjs");
const { LocalConnection } = require("../electron/local.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/uploads-unit-"));
test("queued and active cancellation, acknowledged progress, cleanup, and collision safety", async () => {
  const root = path.join(base, "destination");
  fs.mkdirSync(root);
  const sources = ["active.bin", "queued.bin", "keep.bin", "empty.bin"].map(
    (name) => path.join(base, name),
  );
  sources.forEach((file, i) =>
    fs.writeFileSync(file, Buffer.alloc(i === 3 ? 0 : 65536, i)),
  );
  const connection = new LocalConnection();
  await connection.connect();
  let unblock, entered;
  const blocked = new Promise((resolve) => {
    entered = resolve;
  });
  const release = new Promise((resolve) => {
    unblock = resolve;
  });
  const request = connection.request.bind(connection);
  let first = true;
  connection.request = async (method, args) => {
    const result = await request(method, args);
    if (method === "upload-chunk" && first) {
      first = false;
      entered();
      await release;
    }
    return result;
  };
  const snapshots = [];
  const queue = new UploadQueue((items) => snapshots.push(items));
  try {
    const done = queue.add(connection, root, root, sources);
    assert.equal(queue.snapshot().length, 4);
    assert.ok(queue.snapshot().every((item) => item.status === "queued"));
    await blocked;
    assert.equal(
      queue.snapshot()[0].transferred,
      0,
      "unacknowledged chunk not counted",
    );
    const [active, queued] = queue.snapshot();
    queue.cancel(queued.id);
    queue.cancel(active.id);
    assert.equal(queue.snapshot()[0].status, "stopping");
    unblock();
    const result = await done;
    assert.equal(result.cancelled, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(fs.readdirSync(root).sort(), ["empty.bin", "keep.bin"]);
    assert.deepEqual(
      fs.readFileSync(path.join(root, "keep.bin")),
      fs.readFileSync(sources[2]),
    );
    assert.ok(
      snapshots.some(
        (items) =>
          items[2]?.transferred > 0 && items[2]?.status === "uploading",
      ),
    );
    assert.equal(queue.snapshot()[3].status, "completed");
    const collision = await queue.add(connection, root, root, [sources[2]]);
    assert.equal(collision.failed, 1);
    assert.match(queue.snapshot()[0].error, /exist/i);
    assert.equal(fs.readFileSync(path.join(root, "keep.bin")).length, 65536);
    assert.throws(() => queue.cancel("another-window-id"), /no longer exists/);
    await assert.rejects(
      queue.add(connection, root, root, [base]),
      /regular files/,
    );
  } finally {
    unblock();
    connection.close();
  }
});

test("stop cannot misreport a committed upload as cancelled; failures do not block later files", async () => {
  const root = path.join(base, "commit");
  fs.mkdirSync(root);
  const source = path.join(base, "commit.bin");
  fs.writeFileSync(source, "ready");
  const connection = new LocalConnection();
  await connection.connect();
  const queue = new UploadQueue((items) => {
    if (items[0]?.status === "finishing")
      assert.equal(queue.cancel(items[0].id), false);
  });
  try {
    await queue.add(connection, root, root, [source]);
    assert.equal(queue.snapshot()[0].status, "completed");
    const next = path.join(base, "after.bin");
    fs.writeFileSync(next, "next");
    const result = await queue.add(connection, root, root, [source, next]);
    assert.equal(result.failed, 1);
    assert.equal(result.paths.length, 1);
    assert.equal(fs.readFileSync(path.join(root, "after.bin"), "utf8"), "next");
  } finally {
    connection.close();
  }
});
