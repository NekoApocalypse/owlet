const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(path.join(workspace, "artifacts/upload-progress-"));
const remote = !!process.env.OWLET_SSH_TARGET;
const fixture = remote ? require("./fixture.cjs") : null;
const root = remote
  ? fixture.python(
      'import tempfile,os; p=tempfile.mkdtemp(prefix="owlet-progress-");os.mkdir(p+"/Inbox");print(p)',
    )
  : path.join(base, "workspace").replaceAll("\\", "/");
if (!remote) fs.mkdirSync(root + "/Inbox", { recursive: true });
const files = ["Agent-output.bin", "Queued-note.txt", "Finished-note.txt"].map(
  (name) => path.join(base, name),
);
files.forEach((file, index) =>
  fs.writeFileSync(
    file,
    Buffer.alloc(index === 0 ? 1048576 : 131072, index + 1),
  ),
);
let app;
async function until(fn) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 45000)
      throw Error("Timed out waiting for upload state");
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: remote ? [] : ["--local", root],
        }
      : { args: [workspace, ...(remote ? [] : ["--local", root])] }),
    env: {
      ...process.env,
      OWLET_USER_DATA: path.join(base, "profile"),
      ...(remote ? { LWR_SSH_TARGET: fixture.target, LWR_ROOT: root } : {}),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.locator('[data-ready="true"]').waitFor();
  // Delay actual transport requests only in this isolated test process, making
  // progress and cancellation observable without shipping any production hooks.
  await app.evaluate(({ app }, remote) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const path = require("node:path");
    const backend = require(
      path.join(
        app.getAppPath(),
        "electron",
        remote ? "connection.cjs" : "local.cjs",
      ),
    );
    const proto = (backend.Connection || backend.LocalConnection).prototype;
    const original = proto.request;
    proto.request = async function (method, args) {
      if (method === "upload-chunk")
        await new Promise((resolve) => setTimeout(resolve, 180));
      return original.call(this, method, args);
    };
  }, remote);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => page.evaluate(() => window.lwr.uploads());
  const folder = page.locator('.tree-row[title="' + root + '/Inbox"]');
  const box = await folder.boundingBox(),
    cdp = await page.context().newCDPSession(page);
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      data: { items: [], files, dragOperationsMask: 1 },
    });
  await page.getByRole("region", { name: "File transfers" }).waitFor();
  await until(async () => (await page.locator(".tree-upload").count()) === 3);
  const initial = await state();
  assert.equal(initial.length, 3);
  await until(async () => (await state())[0].transferred > 0);
  await page.screenshot({ path: path.join(base, "upload-progress.png") });
  const rowHeight = await page
    .locator(".tree-upload")
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  assert.equal(
    rowHeight,
    await folder.evaluate((el) => el.getBoundingClientRect().height),
  );
  await page
    .getByRole("button", { name: "Hide transfers", exact: true })
    .click();
  assert.equal(await page.locator(".uploads-popup").count(), 0);
  const before = (await state())[0].transferred;
  await until(async () => (await state())[0].transferred > before);
  assert.equal(
    await page.locator(".uploads-popup").count(),
    0,
    "progress must not unhide popup",
  );
  const items = await cmd("uploads.show");
  await cmd("uploads.stop", { id: items[1].id });
  await page
    .getByRole("button", { name: "Stop upload Agent-output.bin", exact: true })
    .click();
  await until(
    async () =>
      (await state()).filter((item) => item.status === "cancelled").length ===
      2,
  );
  await page
    .locator(".tree-upload")
    .filter({ hasText: "Agent-output.bin" })
    .waitFor({ state: "detached" });
  // Transfers and their UI state survive a renderer reload.
  await cmd("window.reload");
  await page.locator('[data-ready="true"]').waitFor();
  await until(async () => (await state())[2]?.status === "completed");
  await page
    .locator('.tree-row[title="' + root + '/Inbox/Finished-note.txt"]')
    .waitFor();
  const entries = await page.evaluate(
    (path) => window.lwr.remote("list", { path }),
    root + "/Inbox",
  );
  assert.deepEqual(
    entries.entries.map((entry) => entry.name),
    ["Finished-note.txt"],
  );
  const result = await cmd("file.import", {
    directory: root + "/Inbox",
    paths: [files[2]],
  });
  assert.equal(result.failed, 1);
  await page.locator(".upload-error").waitFor();
  await page.screenshot({ path: path.join(base, "upload-conflict.png") });
  assert.equal((await cmd("uploads.show"))[0].status, "failed");
  console.log(
    JSON.stringify({
      passed: true,
      remote,
      base,
      checks: [
        "native multi-file drop",
        "immediate Explorer rows",
        "acknowledged progress",
        "hide without stopping",
        "per-file queued and active cancellation",
        "abort cleanup",
        "remaining file completion",
        "reload recovery",
        "no overwrite on collision",
      ],
    }),
  );
})()
  .catch((error) => {
    console.error(error);
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
    if (remote && /^\/tmp\/owlet-progress-[\w-]+$/.test(root))
      fixture.python(`import shutil;shutil.rmtree(${JSON.stringify(root)})`);
  });
