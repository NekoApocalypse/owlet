const { _electron } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(root, "artifacts/remote-startup-")),
  profile = path.join(base, "profile");
const target = process.env.OWLET_SSH_TARGET,
  remote = process.env.OWLET_TEST_REMOTE_ROOT;
if (!target || !remote)
  throw Error("Set OWLET_SSH_TARGET and OWLET_TEST_REMOTE_ROOT");
fs.mkdirSync(profile);
fs.writeFileSync(
  path.join(profile, "recent-workspaces.json"),
  JSON.stringify([{ kind: "ssh", target, path: remote }]),
);
let app;
(async () => {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", base],
    env: { ...process.env, OWLET_USER_DATA: profile },
  });
  await app.evaluate(({ app, BrowserWindow, screen }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const { Connection } = require(
      require("path").join(app.getAppPath(), "electron/connection.cjs"),
    );
    const original = Connection.prototype.connect;
    globalThis.__startupMode = "delay";
    globalThis.__lists = 0;
    Connection.prototype.connect = function () {
      if (globalThis.__startupMode === "real") return original.call(this);
      if (this.__delayed) return this.__delayed;
      this.state = { ...this.state, status: "connecting", error: undefined };
      this.emit("state", this.state);
      this.__delayed = new Promise((resolve, reject) => {
        globalThis.__fail = () => {
          this.state = {
            ...this.state,
            status: "disconnected",
            error: "ssh: connect to host: No route to host",
          };
          this.emit("state", this.state);
          reject(Error(this.state.error));
        };
      });
      return this.__delayed;
    };
    const request = Connection.prototype.request;
    Connection.prototype.request = function (method, args) {
      if (method === "list") {
        globalThis.__lists++;
        if (globalThis.__missing)
          return Promise.reject(Error("[Errno 2] No such file or directory"));
      }
      return request.call(this, method, args);
    };
    const area = screen.getPrimaryDisplay().workArea;
    BrowserWindow.getAllWindows()[0].setBounds({
      x: area.x,
      y: area.y,
      width: 850,
      height: 600,
    });
  });
  const page = await app.firstWindow();
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).waitFor();
  const next = app.waitForEvent("window");
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).click();
  const opened = await next;
  await opened
    .locator(".welcome-connection")
    .filter({ hasText: "Connecting to" })
    .waitFor();
  assert.equal(
    await app.evaluate(() => globalThis.__lists),
    0,
    "No filesystem requests before SSH connects",
  );
  const positions = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .sort((a, b) => a.id - b.id)
      .map((w) => w.getBounds()),
  );
  assert.notDeepEqual(positions[0], positions[1]);
  assert.equal(positions[1].x, positions[0].x + 32);
  await app.evaluate(() => globalThis.__fail());
  await opened
    .getByRole("alert")
    .filter({ hasText: "No route to host" })
    .waitFor();
  assert(
    !(await opened.locator(".tree").innerText()).includes(
      "no longer available",
    ),
  );
  assert.equal(
    (
      await opened.evaluate(() =>
        window.owletCommands.execute("workspace.state", { readOnly: true }),
      )
    ).root,
    remote,
  );
  await opened.screenshot({ path: path.join(base, "connection-failure.png") });
  await app.evaluate(() => {
    globalThis.__startupMode = "real";
  });
  await opened
    .locator(".welcome-connection")
    .getByRole("button", { name: "Reconnect" })
    .click();
  await opened.locator('[data-ready="true"]').waitFor({ timeout: 30000 });
  assert.equal(
    (
      await opened.evaluate(() =>
        window.owletCommands.execute("workspace.state", { readOnly: true }),
      )
    ).root,
    remote,
  );
  assert.equal(await opened.locator(".welcome-connection").count(), 0);
  await app.evaluate(() => {
    globalThis.__missing = true;
  });
  await opened.evaluate(() => window.owletCommands.execute("explorer.refresh"));
  await opened
    .locator(".tree-hint")
    .filter({ hasText: "no longer available" })
    .waitFor();
  assert.equal(
    await opened.locator(".welcome-connection").count(),
    0,
    "Missing folder is distinct from SSH failure",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "Delayed SSH displays connecting and sends no listing requests",
          "SSH failure retains its reason and requested folder",
          "Reconnect opens requested folder over real SSH",
          "Missing-folder errors remain distinct",
          "New window cascades from origin",
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
  });
