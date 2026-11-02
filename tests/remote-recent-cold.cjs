const { _electron } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(root, "artifacts/remote-recent-cold-")),
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
  const page = await app.firstWindow();
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).waitFor();
  const next = app.waitForEvent("window");
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).click();
  const opened = await next;
  await opened.waitForFunction(() => !!window.owletCommands);
  await opened.waitForTimeout(7000);
  const state = await opened.evaluate(() =>
    window.owletCommands.execute("workspace.state", { readOnly: true }),
  );
  const text = await opened.locator("body").innerText();
  console.log(JSON.stringify({ base, state, text }, null, 2));
  await opened.screenshot({ path: path.join(base, "remote-recent.png") });
  assert.equal(state.root, remote);
  await opened.locator('[data-ready="true"]').waitFor({ timeout: 20000 });
  assert(!/Root does not exist|no such file|ENOENT/i.test(text));
  // Reopening an already connected host uses the same backend but a new window.
  const warmWindow = app.waitForEvent("window");
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).click();
  const warm = await warmWindow;
  await warm.locator('[data-ready="true"]').waitFor({ timeout: 20000 });
  assert.equal(
    (
      await warm.evaluate(() =>
        window.owletCommands.execute("workspace.state", { readOnly: true }),
      )
    ).root,
    remote,
  );
  // A recent entry must also reopen after the SSH session was disconnected.
  await opened.evaluate(() => window.lwr.disconnect());
  const reconnectedWindow = app.waitForEvent("window");
  await page.locator(".welcome-recent").filter({ hasText: "SSH:" }).click();
  const reconnected = await reconnectedWindow;
  await reconnected.locator('[data-ready="true"]').waitFor({ timeout: 20000 });
  assert.equal(
    (
      await reconnected.evaluate(() =>
        window.owletCommands.execute("workspace.state", { readOnly: true }),
      )
    ).root,
    remote,
  );
  console.log("PASS: Cold remote Recent opens the requested directory");
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
