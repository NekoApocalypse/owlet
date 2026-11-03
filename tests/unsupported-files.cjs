const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = fs.mkdtempSync(path.resolve("artifacts/unsupported-")),
  root = base.replaceAll("\\", "/");
fs.mkdirSync(path.join(base, "nested"));
fs.writeFileSync(
  path.join(base, "nested/archive.bin"),
  Buffer.from([0, 1, 2, 3]),
);
fs.writeFileSync(path.join(base, "legacy.dat"), Buffer.from([255, 254, 200]));
fs.writeFileSync(path.join(base, "large.txt"), "x".repeat(4 * 1024 * 1024 + 1));
fs.writeFileSync(path.join(base, "notes.unusual"), "ordinary UTF-8 text");
fs.writeFileSync(path.join(base, "broken.png"), "invalid image");
let app;
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
async function unavailable(page, file) {
  await page.locator(".unsupported-file").waitFor();
  await page.waitForFunction(
    (file) => document.activeElement?.getAttribute("data-file-path") === file,
    file,
  );
  assert.equal(
    await page.locator(".tree-row.selected").getAttribute("data-file-path"),
    file,
  );
  assert((await cmd(page, "file.inspect", { readOnly: true })).unsupported);
  await assert.rejects(
    cmd(page, "editor.setText", { text: "should not edit" }),
    /unavailable|text file/,
  );
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
    const { LocalConnection } = require(
      require("path").join(app.getAppPath(), "electron/local.cjs"),
    );
    const download = LocalConnection.prototype.download;
    globalThis.__unsupportedReads = 0;
    LocalConnection.prototype.download = function (args, ...rest) {
      if (args.path.endsWith("archive.bin")) globalThis.__unsupportedReads++;
      return download.call(this, args, ...rest);
    };
  });
  await cmd(page, "terminal.toggle", { visible: false });
  await cmd(page, "file.open", { path: root + "/notes.unusual" });
  await cmd(page, "editor.setText", { text: "my unsaved notes" });
  await cmd(page, "explorer.toggle");
  await cmd(page, "file.open", { path: root + "/nested/archive.bin" });
  await unavailable(page, root + "/nested/archive.bin");
  await page.screenshot({ path: path.join(base, "unsupported.png") });
  await page.waitForTimeout(2300);
  assert.equal(
    await app.evaluate(() => globalThis.__unsupportedReads),
    1,
    "Temporary tabs must not poll/re-read unsupported bytes",
  );
  await cmd(page, "commands.show");
  assert.equal(await page.locator(".unsupported-file").count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^notes.unusual/ }).click();
  assert.equal(
    await page.getByRole("tab", { name: /Unsupported file/ }).count(),
    0,
  );
  assert.equal(
    (await cmd(page, "file.inspect", { readOnly: true })).text,
    "my unsaved notes",
  );
  for (const name of ["legacy.dat", "large.txt", "broken.png"]) {
    await cmd(page, "file.open", { path: root + "/" + name });
    await unavailable(page, root + "/" + name);
    assert.equal(
      await page.getByRole("tab", { name: /Unsupported file/ }).count(),
      1,
    );
  }
  await cmd(page, "tab.activate", { path: root + "/notes.unusual" });
  await cmd(page, "group.splitRight");
  const second = (await cmd(page, "workspace.state", { readOnly: true }))
    .activeGroup;
  await cmd(page, "file.open", { path: root + "/nested/archive.bin" });
  await unavailable(page, root + "/nested/archive.bin");
  await cmd(page, "group.focus", { group: 1 });
  assert.equal(await page.locator(".unsupported-file").count(), 0);
  await cmd(page, "file.open", {
    path: root + "/nested/archive.bin",
    group: second,
  });
  await unavailable(page, root + "/nested/archive.bin");
  await cmd(page, "terminal.focus");
  await page.waitForFunction(
    () => !document.querySelector(".unsupported-file"),
  );
  // Reopening retries: the failure is not a cached pseudo-document.
  fs.writeFileSync(path.join(base, "nested/archive.bin"), "now valid text");
  await cmd(page, "file.open", { path: root + "/nested/archive.bin" });
  assert.equal(
    (await cmd(page, "file.inspect", { readOnly: true })).text,
    "now valid text",
  );
  await cmd(page, "file.open", { path: root + "/missing.bin" });
  assert.equal(
    await page.locator(".unsupported-file").count(),
    0,
    "Missing files are not unsupported types",
  );
  if (process.env.OWLET_SSH_TARGET) {
    const { python, target } = require("./fixture.cjs");
    const remoteRoot = python(
      "import tempfile,pathlib; p=pathlib.Path(tempfile.mkdtemp(prefix='owlet-unsupported-')); (p/'archive.bin').write_bytes(bytes([0,1,2])); (p/'notes.txt').write_text('remote text'); print(p)",
    );
    try {
      const next = app.waitForEvent("window");
      await cmd(page, "workspace.openSSH", { target, path: remoteRoot });
      const remote = await next;
      await remote.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
      await cmd(remote, "file.open", { path: remoteRoot + "/archive.bin" });
      await unavailable(remote, remoteRoot + "/archive.bin");
      await cmd(remote, "file.open", { path: remoteRoot + "/notes.txt" });
      assert.equal(await remote.locator(".unsupported-file").count(), 0);
    } finally {
      if (/^\/tmp\/owlet-unsupported-[\w-]+$/.test(remoteRoot))
        python(`import shutil; shutil.rmtree(${JSON.stringify(remoteRoot)})`);
    }
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "Binary/encoding/size/image failures open transient tabs and focus Explorer",
          "Switching tab/group/terminal dismisses the notice; dirty edits survive",
          "Palette does not dismiss; reopening retries; missing files stay separate",
          "Local and configured SSH unsupported files",
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
