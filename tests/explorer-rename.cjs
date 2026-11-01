const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const workspace = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(
  path.join(workspace, "artifacts/explorer-rename-"),
);
const root = path.join(fixture, "project");
fs.mkdirSync(path.join(root, "old", "nested"), { recursive: true });
fs.writeFileSync(path.join(root, "old", "nested", "note.md"), "# Original\n");
let app;
const results = [];
const command = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
const normalize = (value) => value.replaceAll("\\", "/");
async function refresh(page) {
  await command(page, "explorer.refresh");
  await page.waitForTimeout(350);
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [workspace, "--local", root] }),
    env: { ...process.env, OWLET_USER_DATA: path.join(fixture, "profile") },
  });
  await app.evaluate(({ app }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    globalThis.__listRequests = [];
    for (const [file, name] of [
      ["local.cjs", "LocalConnection"],
      ["connection.cjs", "Connection"],
    ]) {
      const klass = require(
        require("node:path").join(app.getAppPath(), "electron", file),
      )[name];
      const original = klass.prototype.request;
      klass.prototype.request = function (method, args) {
        if (method === "list") globalThis.__listRequests.push(args.path);
        return original.call(this, method, args);
      };
    }
  });
  const page = await app.firstWindow();
  await page.locator("[data-ready=true]").waitFor();
  const old = normalize(path.join(root, "old")),
    nested = old + "/nested",
    note = nested + "/note.md";
  await command(page, "explorer.expand", { path: old });
  await page.locator(`.tree-row[title="${nested}"]`).waitFor();
  await command(page, "explorer.expand", { path: nested });
  await page.locator(`.tree-row[title="${note}"]`).waitFor();
  await command(page, "file.open", { path: note });
  await command(page, "editor.setText", { text: "# Unsaved work\n" });
  fs.renameSync(path.join(root, "old"), path.join(root, "renamed"));
  await refresh(page);
  await page.locator(`.tree-row[title="${normalize(root)}/renamed"]`).waitFor();
  await page.locator(`.tree-row[title="${old}"]`).waitFor({ state: "hidden" });
  const calls = await app.evaluate(
    () =>
      globalThis.__listRequests.filter(
        (p) => p.endsWith("/old") || p.endsWith("/old/nested"),
      ).length,
  );
  for (let i = 0; i < 3; i++) await refresh(page);
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.__listRequests.filter(
          (p) => p.endsWith("/old") || p.endsWith("/old/nested"),
        ).length,
    ),
    calls,
  );
  assert.equal(
    await page
      .locator(".toast")
      .filter({ hasText: /ENOENT|No such file|Errno 2/ })
      .count(),
    0,
  );
  assert.equal(
    (await command(page, "file.inspect", { readOnly: true })).text,
    "# Unsaved work\n",
  );
  results.push(
    "Renaming an expanded local subtree prunes obsolete watches, refreshes the parent, and preserves unsaved buffers without repeat errors",
  );
  await command(page, "explorer.expand", {
    path: normalize(root) + "/renamed",
  });
  await page
    .locator(`.tree-row[title="${normalize(root)}/renamed/nested"]`)
    .waitFor();
  fs.renameSync(path.join(root, "renamed"), path.join(root, "old"));
  await refresh(page);
  await command(page, "explorer.expand", { path: old });
  await page.locator(`.tree-row[title="${nested}"]`).waitFor();
  results.push("A directory recreated at the old path can be expanded again");
  if (process.env.OWLET_SSH_TARGET) {
    const f = require("./fixture.cjs");
    const remoteFixture = f.createFixture();
    const remoteOld = remoteFixture.root + "/rename-source";
    f.python(
      `import os\nos.makedirs(${JSON.stringify(remoteOld + "/nested")})\n`,
    );
    const opened = app.waitForEvent("window");
    await command(page, "workspace.openSSH", {
      target: process.env.OWLET_SSH_TARGET,
      path: remoteFixture.root,
    });
    const remote = await opened;
    await remote.locator("[data-ready=true]").waitFor();
    await command(remote, "explorer.expand", { path: remoteOld });
    await remote.locator(`.tree-row[title="${remoteOld}/nested"]`).waitFor();
    f.python(
      `import os\nos.rename(${JSON.stringify(remoteOld)}, ${JSON.stringify(remoteFixture.root + "/rename-destination")})\n`,
    );
    await refresh(remote);
    await remote
      .locator(`.tree-row[title="${remoteFixture.root}/rename-destination"]`)
      .waitFor();
    const count = await app.evaluate(
      (p) => globalThis.__listRequests.filter((item) => item === p).length,
      remoteOld,
    );
    for (let i = 0; i < 3; i++) await refresh(remote);
    assert.equal(
      await app.evaluate(
        (p) => globalThis.__listRequests.filter((item) => item === p).length,
        remoteOld,
      ),
      count,
    );
    assert.equal(
      await remote
        .locator(".toast")
        .filter({ hasText: /No such file|Errno 2/ })
        .count(),
      0,
    );
    f.python(
      `import os\nos.rename(${JSON.stringify(remoteFixture.root)}, ${JSON.stringify(remoteFixture.root + "-moved")})\n`,
    );
    await refresh(remote);
    await remote
      .getByText(/This workspace folder is no longer available/)
      .waitFor();
    for (let i = 0; i < 2; i++) await refresh(remote);
    assert.equal(
      await remote
        .locator(".toast")
        .filter({ hasText: /No such file|Errno 2/ })
        .count(),
      0,
    );
    f.python(
      `import os\nos.rename(${JSON.stringify(remoteFixture.root + "-moved")}, ${JSON.stringify(remoteFixture.root)})\n`,
    );
    await refresh(remote);
    await remote
      .getByText(/This workspace folder is no longer available/)
      .waitFor({ state: "hidden" });
    results.push(
      "Real SSH child rename stops obsolete requests; renamed workspace root shows an inline notice and recovers on restoration",
    );
  }
  fs.writeFileSync(
    path.join(workspace, "artifacts/explorer-rename-results.json"),
    JSON.stringify({ results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
  });
