const { test } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { LocalConnection } = require("../electron/local.cjs");
const { importFiles, downloadFile } = require("../electron/transfers.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/file-operations-"));
const display = (p) => p.replaceAll("\\", "/");
async function exercise(connection, root, read, write) {
  const op = (args) => connection.request("fs-operation", { root, ...args });
  const folder = await op({
    op: "create-folder",
    directory: root,
    name: "Folder space",
  });
  const file = await op({
    op: "create-file",
    directory: folder.path,
    name: "图.txt",
  });
  await assert.rejects(
    op({ op: "create-file", directory: folder.path, name: "图.txt" }),
  );
  await assert.rejects(
    op({ op: "create-file", directory: folder.path, name: "../escape" }),
  );
  await assert.rejects(
    op({ op: "delete", path: root, revision: "any" }),
    /root|workspace/i,
  );
  await write(file.path, "before");
  const previous = await op({ op: "inspect", path: file.path });
  await write(file.path, "after - updated");
  await assert.rejects(
    op({ op: "delete", path: file.path, revision: previous.revision }),
    /changed/i,
  );
  const current = await op({ op: "inspect", path: file.path });
  const dest = folder.path + "/renamed.txt";
  await op({
    op: "move",
    path: file.path,
    destination: dest,
    revision: current.revision,
  });
  assert.equal(await read(dest), "after - updated");
  const collision = await op({
    op: "create-file",
    directory: folder.path,
    name: "exists.txt",
  });
  const renamed = await op({ op: "inspect", path: dest });
  await assert.rejects(
    op({
      op: "move",
      path: dest,
      destination: collision.path,
      revision: renamed.revision,
    }),
    /exists/i,
  );
  assert.equal(await read(dest), "after - updated");
  const source = path.join(base, crypto.randomUUID() + ".bin"),
    data = crypto.randomBytes(96 * 1024 + 7);
  fs.writeFileSync(source, data);
  const imported = await importFiles(connection, root, folder.path, [source]);
  if (connection.kind === "ssh") {
    const download = path.join(base, crypto.randomUUID() + ".bin");
    await downloadFile(connection, root, imported.paths[0], download);
    assert.deepEqual(fs.readFileSync(download), data);
    await assert.rejects(
      downloadFile(connection, root, imported.paths[0], download),
      /exists/i,
    );
    const changed = await connection.request("download-open", {
      root,
      path: dest,
    });
    await write(dest, "changed during download");
    await assert.rejects(
      connection.request("download-finish", { token: changed.token }),
      /changed/i,
    );
  } else assert.deepEqual(fs.readFileSync(imported.paths[0]), data);
  await assert.rejects(
    importFiles(connection, root, folder.path, [source]),
    /exists/i,
  );
  await assert.rejects(
    importFiles(connection, root, folder.path, [base]),
    /regular files/i,
  );
  const upload = await connection.request("upload-start", {
    root,
    directory: folder.path,
    name: "aborted.bin",
    size: 5,
  });
  await assert.rejects(
    connection.request("upload-chunk", {
      token: upload.token,
      offset: 2,
      data: "eA==",
    }),
    /chunk/i,
  );
  await connection.request("upload-abort", upload);
  const listing = await connection.request("list", { path: folder.path });
  assert.ok(
    !listing.entries.some(
      (e) => e.name.startsWith(".owlet-upload-") || e.name === "aborted.bin",
    ),
  );
  const copySource = await op({ op: "inspect", path: folder.path });
  const duplicate = root + "/Folder copy";
  await op({
    op: "copy",
    path: folder.path,
    destination: duplicate,
    revision: copySource.revision,
  });
  assert.equal(
    await read(duplicate + "/renamed.txt"),
    await read(folder.path + "/renamed.txt"),
  );
  await assert.rejects(
    op({
      op: "copy",
      path: folder.path,
      destination: duplicate,
      revision: copySource.revision,
    }),
    /exists/i,
  );
  await assert.rejects(
    op({
      op: "copy",
      path: folder.path,
      destination: folder.path + "/inside",
      revision: copySource.revision,
    }),
    /itself/i,
  );
  const copyMeta = await op({ op: "inspect", path: duplicate });
  await op({ op: "delete", path: duplicate, revision: copyMeta.revision });
  const tree = await op({ op: "inspect", path: folder.path });
  await op({ op: "delete", path: folder.path, revision: tree.revision });
  await assert.rejects(op({ op: "inspect", path: folder.path }));
}
test("local file operations: guarded moves/deletes, no overwrite, streamed copy and abort cleanup", async () => {
  const root = display(path.join(base, "local"));
  fs.mkdirSync(root);
  const c = new LocalConnection();
  await c.connect();
  try {
    await exercise(
      c,
      root,
      (p) => fs.readFileSync(p, "utf8"),
      (p, text) => fs.writeFileSync(p, text),
    );
  } finally {
    c.close();
  }
});
test(
  "real SSH operations and binary upload/download round trip",
  { skip: !process.env.OWLET_SSH_TARGET, timeout: 90000 },
  async () => {
    const { python, target } = require("./fixture.cjs");
    const { Connection } = require("../electron/connection.cjs");
    const root = python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-files-",dir=' +
        JSON.stringify(process.env.OWLET_TEST_TMPDIR || "/tmp") +
        "))",
    );
    const c = new Connection(target);
    await c.connect();
    try {
      assert.ok(c.metrics.bootstrap < 32768);
      await exercise(
        c,
        root,
        async (p) => (await c.download({ path: p })).text,
        async (p, text) => {
          const old = await c.download({ path: p });
          return c.request("save", { path: p, text, revision: old.revision });
        },
      );
    } finally {
      c.close();
    }
  },
);
