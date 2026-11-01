const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(workspace, "artifacts/recent-test-"));
const profile = path.join(fixture, "profile");
const first = path.join(fixture, "first"),
  second = path.join(fixture, "second");
for (const folder of [first, second]) fs.mkdirSync(folder);
const normalized = (value) => value.replaceAll("\\", "/");
let app;
const results = [];
const command = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
const ready = (page) => page.waitForFunction(() => !!window.owletCommands);
async function launch() {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", first],
        }
      : { args: [workspace, "--local", first] }),
    env: { ...process.env, OWLET_USER_DATA: profile },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  return page;
}
async function close() {
  if (!app) return;
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    })
    .catch(() => {});
  await app.close().catch(() => {});
}
async function opened(page, id, args) {
  const next = app.waitForEvent("window");
  await command(page, id, args);
  const child = await next;
  await ready(child);
  return child;
}
(async () => {
  let page = await launch();
  await page.waitForFunction(
    async () => (await window.lwr.recent()).length === 1,
  );
  // Observe the native menu's actual template; suppress only its popup during automation.
  await app.evaluate(({ Menu }) => {
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = function (template) {
      globalThis.__recentMenu = template;
      const menu = original.call(this, template);
      menu.popup = () => {};
      return menu;
    };
  });
  await page.getByRole("button", { name: "File", exact: true }).click();
  const blankOpened = app.waitForEvent("window");
  await app.evaluate(() => {
    if (!globalThis.__recentMenu.some((item) => item.label === "Open Recent"))
      throw Error("Missing native submenu");
    globalThis.__recentMenu.find((item) => item.label === "New Window").click();
  });
  const blank = await blankOpened;
  await ready(blank);
  await blank.getByRole("heading", { name: "A clearer view." }).waitFor();
  assert.equal(
    (await command(blank, "workspace.state", { readOnly: true })).root,
    "",
  );
  assert.equal(
    (await command(page, "workspace.recent", { readOnly: true })).length,
    1,
  );
  results.push(
    "File menu dispatches New Window; blank windows do not pollute history",
  );
  const local = await opened(page, "workspace.openLocal", { path: second });
  await local.locator('[data-ready="true"]').waitFor();
  await page.waitForFunction(
    async () => (await window.lwr.recent()).length === 2,
  );
  let entries = await command(page, "workspace.recent", { readOnly: true });
  assert.equal(entries[0].path, normalized(second));
  await page.keyboard.press("Control+Alt+r");
  await page.getByRole("dialog", { name: "Recently Opened Windows" }).waitFor();
  await page
    .getByRole("textbox", { name: "Search recent workspaces" })
    .fill("second");
  const nextLocal = app.waitForEvent("window");
  await page.getByRole("option").click();
  const reopened = await nextLocal;
  await reopened.locator('[data-ready="true"]').waitFor();
  assert.equal(
    (await command(reopened, "workspace.state", { readOnly: true })).root,
    normalized(second),
  );
  assert.equal(
    (await command(page, "workspace.recent", { readOnly: true })).length,
    2,
  );
  results.push(
    "Local folders are shared across windows, searchable, deduplicated, and reopen in a new window",
  );
  let remoteEntry;
  if (process.env.OWLET_SSH_TARGET) {
    const remoteFixture = require("./fixture.cjs").createFixture();
    const remote = await opened(page, "workspace.openSSH", {
      target: process.env.OWLET_SSH_TARGET,
      path: remoteFixture.root,
    });
    await remote.locator('[data-ready="true"]').waitFor();
    await page.waitForFunction(async () =>
      (await window.lwr.recent()).some((entry) => entry.kind === "ssh"),
    );
    remoteEntry = (
      await command(page, "workspace.recent", { readOnly: true })
    ).find((item) => item.kind === "ssh");
    assert.equal(remoteEntry.path, remoteFixture.root);
    assert.equal(remoteEntry.target, process.env.OWLET_SSH_TARGET);
    const again = await opened(page, "workspace.openRecent", {
      id: remoteEntry.id,
    });
    await again.locator('[data-ready="true"]').waitFor();
    assert.equal(
      (await again.evaluate(() => window.lwr.bootstrap())).connection.kind,
      "ssh",
    );
    results.push(
      "Real SSH history retains host and directory and reconnects correctly",
    );
  }
  await close();
  page = await launch();
  entries = await command(page, "workspace.recent", { readOnly: true });
  assert.ok(entries.some((item) => item.path === normalized(second)));
  if (remoteEntry)
    assert.ok(entries.some((item) => item.id === remoteEntry.id));
  await command(page, "commands.show");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Recently Opened Windows");
  await page.getByRole("option").first().click();
  await page.getByRole("dialog", { name: "Recently Opened Windows" }).waitFor();
  await page.screenshot({
    path: path.join(workspace, "artifacts/recent-proof.png"),
  });
  await page.getByRole("button", { name: "Close recent workspaces" }).click();
  await command(page, "workspace.removeRecent", {
    id: entries.find((item) => item.path === normalized(second)).id,
  });
  assert.ok(fs.existsSync(second));
  await command(page, "workspace.clearRecent");
  const state = await command(page, "workspace.state", { readOnly: true });
  await command(page, "confirmation.accept", {
    token: state.confirmation.token,
  });
  assert.deepEqual(
    await command(page, "workspace.recent", { readOnly: true }),
    [],
  );
  await assert.rejects(
    command(page, "workspace.openRecent", { id: "missing" }),
    /no longer/,
  );
  results.push(
    "History survives full restart; palette discovery, remove, clear, and stale ID safeguards work",
  );
  fs.writeFileSync(
    path.join(workspace, "artifacts/recent-results.json"),
    JSON.stringify({ packaged: !!process.env.LWR_PACKAGED, results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(close);
