const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { python, target } = require("./fixture.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/auto-reconnect-"));
const remoteRoot = python(
  "import tempfile,pathlib; p=pathlib.Path(tempfile.mkdtemp(prefix='owlet-reconnect-')); (p/'clean.txt').write_text('before'); (p/'dirty.txt').write_text('before'); print(p)",
);
let app;
async function until(page, predicate, arg, { timeout = 30000 } = {}) {
  const started = Date.now();
  while (!(await page.evaluate(predicate, arg))) {
    if (Date.now() - started > timeout)
      throw Error("Timed out waiting for recovery state");
    await page.waitForTimeout(80);
  }
}
(async () => {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", base],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  await app.evaluate(({ app }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const { Connection } = require(
      require("path").join(app.getAppPath(), "electron/connection.cjs"),
    );
    const connect = Connection.prototype.connect;
    Connection.prototype.connect = function () {
      globalThis.__testConnection = this;
      if (!this.__instrumented) {
        this.__instrumented = true;
        const spawn = this.spawnProcess;
        this.spawnProcess = (...args) => {
          globalThis.__attempts = (globalThis.__attempts || 0) + 1;
          if (!globalThis.__outage) return spawn(...args);
          const child = new (require("events").EventEmitter)();
          for (const stream of ["stdin", "stdout", "stderr"])
            child[stream] = new (require("stream").PassThrough)();
          child.kill = () => {};
          setImmediate(() => {
            child.stderr.write("Network is unreachable");
            child.emit("exit", 255);
          });
          return child;
        };
      }
      return connect.call(this);
    };
  });
  const cmd = (p, id, args = {}) =>
    p.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const next = app.waitForEvent("window");
  await cmd(page, "workspace.openSSH", { target, path: remoteRoot });
  const remote = await next;
  await remote.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
  await cmd(remote, "file.open", { path: remoteRoot + "/dirty.txt" });
  await cmd(remote, "editor.setText", {
    path: remoteRoot + "/dirty.txt",
    text: "my unsaved edits",
  });
  await cmd(remote, "group.splitRight");
  await cmd(remote, "file.open", { path: remoteRoot + "/clean.txt" });
  await until(remote, async () =>
    (
      await window.owletCommands.execute("workspace.state", { readOnly: true })
    ).terminal.sessions.some((t) => t.status === "running"),
  );
  await app.evaluate(() => {
    globalThis.__outage = true;
    globalThis.__testConnection.child.kill();
  });
  await until(
    remote,
    async () =>
      (
        await window.owletCommands.execute("workspace.state", {
          readOnly: true,
        })
      ).connectionDetails.retryDelay >= 2000,
  );
  await remote.screenshot({ path: path.join(base, "retrying.png") });
  assert.equal(
    (await cmd(page, "workspace.state", { readOnly: true })).connection,
    "connected",
    "Local window is unaffected",
  );
  python(
    `import pathlib; p=pathlib.Path(${JSON.stringify(remoteRoot)}); (p/'dirty.txt').write_text('agent changed disk'); (p/'clean.txt').write_text('updated while offline'); (p/'new.txt').write_text('new')`,
  );
  await app.evaluate(() => {
    globalThis.__outage = false;
  });
  await until(
    remote,
    async () =>
      (
        await window.owletCommands.execute("workspace.state", {
          readOnly: true,
        })
      ).connection === "connected",
    null,
    { timeout: 40000 },
  );
  await until(
    remote,
    async (root) =>
      (
        await window.owletCommands.execute("file.inspect", {
          path: root + "/clean.txt",
          readOnly: true,
        })
      ).text === "updated while offline",
    remoteRoot,
  );
  await until(
    remote,
    async (root) =>
      !!(
        await window.owletCommands.execute("file.inspect", {
          path: root + "/dirty.txt",
          readOnly: true,
        })
      ).conflict,
    remoteRoot,
  );
  const dirty = await cmd(remote, "file.inspect", {
    path: remoteRoot + "/dirty.txt",
    readOnly: true,
  });
  assert.equal(dirty.text, "my unsaved edits");
  assert.equal(dirty.conflict.text, "agent changed disk");
  await remote.locator(".tree").getByText("new.txt", { exact: true }).waitFor();
  const recovered = await cmd(remote, "workspace.state", { readOnly: true });
  assert.equal(recovered.root, remoteRoot);
  assert(recovered.terminal.sessions.every((t) => t.status === "disconnected"));
  await cmd(remote, "terminal.start", {
    id: recovered.terminal.sessions[0].id,
  });
  await until(remote, async () =>
    (
      await window.owletCommands.execute("workspace.state", { readOnly: true })
    ).terminal.sessions.some((t) => t.status === "running"),
  );
  // The same command exposed in the palette cancels automatic attempts.
  await app.evaluate(() => {
    globalThis.__outage = true;
    globalThis.__testConnection.child.kill();
  });
  await until(
    remote,
    async () =>
      !!(
        await window.owletCommands.execute("workspace.state", {
          readOnly: true,
        })
      ).connectionDetails.retryDelay,
  );
  await cmd(remote, "connection.disconnect");
  const attempts = await app.evaluate(() => globalThis.__attempts);
  await remote.waitForTimeout(1500);
  assert.equal(await app.evaluate(() => globalThis.__attempts), attempts);
  await app.evaluate(() => {
    globalThis.__outage = false;
  });
  await cmd(remote, "connection.reconnect");
  assert.equal(
    (await cmd(remote, "workspace.state", { readOnly: true })).connection,
    "connected",
  );
  // Closing the last remote window stops its loop even while a local window lives.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__outage = true;
    globalThis.__testConnection.child.kill();
    BrowserWindow.getAllWindows()
      .sort((a, b) => a.id - b.id)
      .at(-1)
      .destroy();
  });
  const closedAttempts = await app.evaluate(() => globalThis.__attempts);
  await page.waitForTimeout(1500);
  assert.equal(await app.evaluate(() => globalThis.__attempts), closedAttempts);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "Real SSH loss, failed automatic attempt, and automatic recovery",
          "Clean files and Explorer refresh; dirty edits and conflicts survive",
          "Shell restart remains explicit; local windows remain connected",
          "Disconnect cancels retries; manual Reconnect works; last-window close stops retries",
        ],
      },
      null,
      2,
    ),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (/^\/tmp\/owlet-reconnect-[\w-]+$/.test(remoteRoot))
      python(`import shutil; shutil.rmtree(${JSON.stringify(remoteRoot)})`);
  });
