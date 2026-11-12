const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/vim-files-")),
  root = path.join(base, "Workspace").replaceAll("\\", "/"),
  profile = path.join(base, "profile");
fs.mkdirSync(root);
fs.mkdirSync(profile);
fs.writeFileSync(
  path.join(profile, "settings.json"),
  JSON.stringify({
    "editor.vimMode": true,
    "editor.fontSize": 20,
    "files.quickOpenMaxDepth": 1,
  }),
);
for (const folder of ["nested", "nested/deep", "a-target", "node_modules"])
  fs.mkdirSync(root + "/" + folder);
for (const [name, text] of Object.entries({
  "alpha.txt": "alpha alpha\nbeta alpha\n",
  "nested/ReadingPlan.md": "# Plan",
  "nested/deep/hidden.txt": "deep",
  "node_modules/ignored.txt": "ignored",
}))
  fs.writeFileSync(root + "/" + name, text);
for (let i = 0; i < 230; i++)
  fs.writeFileSync(
    root + "/file-" + String(i).padStart(3, "0") + ".txt",
    "text",
  );
const external = path.join(base, "external.txt");
fs.writeFileSync(external, "external drop");
const results = [];
let app, page, cmd, state;
async function until(fn, timeout = 20000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout)
      throw Error("Timed out waiting for state");
    await new Promise((r) => setTimeout(r, 80));
  }
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [workspace, "--local", root] }),
    env: { ...process.env, OWLET_USER_DATA: profile },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  state = () => cmd("workspace.state", { readOnly: true });
  await page.locator('[data-ready="true"]').waitFor();
  // A fast local disk can finish indexing before the first keyboard event.
  // Hold list requests briefly in this test process, then restart the index so
  // the partial-results assertions observe a real, deterministic loading state.
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const { LocalConnection } = require(
      app.getAppPath() + "/electron/local.cjs",
    );
    const request = LocalConnection.prototype.request;
    LocalConnection.prototype.request = async function (method, args) {
      if (method === "list")
        await new Promise((resolve) => setTimeout(resolve, 250));
      return request.call(this, method, args);
    };
  });
  await cmd("file.index.refresh");
  await page.keyboard.press("Control+p");
  await page.getByRole("dialog", { name: "Quick Open", exact: true }).waitFor();
  assert.match(
    await page.locator('.quick-open [role="status"]').innerText(),
    /Indexing…/,
  );
  await until(async () => {
    const index = await cmd("file.search", { query: "alpha" });
    return index.loading && index.matches.length === 1;
  });
  await page
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("alptx");
  await page.keyboard.press("Enter");
  await page.locator(".cm-content").waitFor();
  await until(async () => !(await cmd("file.search", { query: "" })).loading);
  assert.equal(
    (await cmd("file.search", { query: "rdpl" })).matches[0].relative,
    "nested/ReadingPlan.md",
  );
  assert.equal(
    (await cmd("file.search", { query: "hidden" })).matches.length,
    0,
  );
  assert.equal(
    (await cmd("file.search", { query: "ignored" })).matches.length,
    0,
  );
  results.push(
    "Ctrl+P shows incomplete index, opens fuzzy match before scan ends, obeys depth and dependency exclusions",
  );
  await cmd("terminal.toggle");
  const inspect = () =>
    cmd("file.inspect", { path: root + "/alpha.txt", readOnly: true });
  if (!(await state()).vimMode) await cmd("editor.vim");
  await cmd("editor.setText", { text: "unsaved" });
  assert.equal(await cmd("editor.vimCommand", { command: "e" }), false);
  assert.equal((await inspect()).text, "unsaved");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type(":e!");
  const sizes = await page
    .locator(".cm-vim-panel input")
    .evaluate((el) => [
      getComputedStyle(el).fontSize,
      getComputedStyle(el.closest(".cm-editor")).fontSize,
    ]);
  assert.deepEqual(sizes, ["20px", "20px"]);
  await page.keyboard.press("Enter");
  await until(
    async () => (await inspect()).text === "alpha alpha\nbeta alpha\n",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.type("/alpha");
  await page.keyboard.press("Enter");
  await until(async () => (await page.locator(".cm-searchMatch").count()) > 0);
  await page.keyboard.press("n");
  await page.keyboard.press("Shift+n");
  await cmd("editor.vimCommand", { command: "noh" });
  await until(
    async () => (await page.locator(".cm-searchMatch").count()) === 0,
  );
  await cmd("editor.vimCommand", { command: "%s/alpha/owl/g" });
  assert.equal((await inspect()).text, "owl owl\nbeta owl\n");
  await cmd("editor.vimCommand", { command: "undo" });
  assert.match((await inspect()).text, /alpha/);
  await cmd("editor.vimCommand", { command: "redo" });
  assert.match((await inspect()).text, /owl/);
  assert.equal(
    await cmd("editor.vimCommand", { command: "w other.txt" }),
    false,
  );
  assert.equal(await cmd("editor.vimCommand", { command: "w" }), true);
  assert.match(fs.readFileSync(root + "/alpha.txt", "utf8"), /owl owl/);
  await cmd("editor.setText", { text: "my edit" });
  fs.writeFileSync(root + "/alpha.txt", "agent edit");
  assert.equal(await cmd("editor.vimCommand", { command: "w!" }), false);
  assert.equal(fs.readFileSync(root + "/alpha.txt", "utf8"), "agent edit");
  await cmd("conflict.keepEditing");
  await cmd("editor.vimCommand", { command: "e!" });
  assert.equal((await inspect()).text, "agent edit");
  await cmd("editor.setText", { text: "updated" });
  await cmd("editor.vimCommand", { command: "up" });
  assert.equal(fs.readFileSync(root + "/alpha.txt", "utf8"), "updated");
  const extra = root + "/a-extra.txt";
  fs.writeFileSync(extra, "original");
  await cmd("editor.setText", { text: "save all one" });
  await cmd("file.open", { path: extra });
  await cmd("editor.setText", { text: "save all two" });
  assert.equal(await cmd("editor.vimCommand", { command: "wa" }), true);
  assert.equal(fs.readFileSync(root + "/alpha.txt", "utf8"), "save all one");
  assert.equal(fs.readFileSync(extra, "utf8"), "save all two");
  await cmd("editor.setText", { text: "save and close" });
  assert.equal(await cmd("editor.vimCommand", { command: "x" }), true);
  assert.equal(fs.readFileSync(extra, "utf8"), "save and close");
  await cmd("file.open", { path: extra });
  await cmd("editor.setText", { text: "keep on failed reload" });
  fs.renameSync(extra, extra + ".away");
  assert.equal(await cmd("editor.vimCommand", { command: "e!" }), false);
  assert.equal(
    (await cmd("file.inspect", { readOnly: true })).text,
    "keep on failed reload",
  );
  fs.renameSync(extra + ".away", extra);
  await cmd("editor.vimCommand", { command: "e!" });
  await cmd("file.open", { path: root + "/alpha.txt" });
  await cmd("editor.setText", { text: "updated" });
  await cmd("file.save");
  results.push(
    "Typed :e! and uniform Vim panel font, :e dirty guard, substitutions, undo/redo, :w/:up and conflict-safe :w!",
  );
  await page
    .locator('.tree-row[title="' + root + '/alpha.txt"]')
    .click({ button: "right" });
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Download…", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("menuitem", { name: "Copy Relative Path", exact: true })
    .click();
  await until(
    async () =>
      (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
      "alpha.txt",
  );
  await page.locator(".tab.active-tab").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
  await until(
    async () =>
      (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
      root + "/alpha.txt",
  );
  await page
    .locator('.tree-row[title="' + root + '/a-target"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File…", exact: true }).click();
  await page.locator(".modal input").fill("created.txt");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await until(() => fs.existsSync(root + "/a-target/created.txt"));
  await cmd("file.newFolder", { directory: root + "/a-target", name: "inner" });
  await cmd("file.open", { path: root + "/alpha.txt" });
  await cmd("file.rename", { name: "a-renamed.txt" });
  let confirm = (await state()).confirmation;
  await cmd("confirmation.accept", { token: confirm.token });
  assert.equal(
    (
      await cmd("file.inspect", {
        path: root + "/a-renamed.txt",
        readOnly: true,
      })
    ).text,
    "updated",
  );
  assert.ok(!fs.existsSync(root + "/alpha.txt"));
  await cmd("editor.setText", { text: "dirty guard" });
  await assert.rejects(
    cmd("file.delete", { path: root + "/a-renamed.txt" }),
    /unsaved|save/i,
  );
  await cmd("file.reload", { discard: true });
  await cmd("file.delete", { path: root + "/a-target/created.txt" });
  confirm = (await state()).confirmation;
  await cmd("confirmation.accept", { token: confirm.token });
  assert.ok(!fs.existsSync(root + "/a-target/created.txt"));
  results.push(
    "Explorer and tab menus target clicked paths; create, rename with open-tab remap, dirty delete guard and confirmed delete",
  );
  await cmd("explorer.refresh");
  await until(
    async () =>
      await page
        .locator('.tree-row[title="' + root + '/a-renamed.txt"]')
        .count(),
  );
  await page
    .locator('.tree-row[title="' + root + '/a-renamed.txt"]')
    .dragTo(page.locator('.tree-row[title="' + root + '/a-target"]'));
  await until(async () => !!(await state()).confirmation);
  confirm = (await state()).confirmation;
  await cmd("confirmation.accept", { token: confirm.token });
  assert.ok(fs.existsSync(root + "/a-target/a-renamed.txt"));
  const cdp = await page.context().newCDPSession(page),
    box = await page
      .locator('.tree-row[title="' + root + '/a-target"]')
      .boundingBox();
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      data: { items: [], files: [external], dragOperationsMask: 1 },
    });
  await until(() => fs.existsSync(root + "/a-target/external.txt"));
  assert.equal(
    fs.readFileSync(root + "/a-target/external.txt", "utf8"),
    "external drop",
  );
  results.push(
    "Actual tree drag moves through confirmation; native external File drop copies through webUtils and backend",
  );
  await cmd("explorer.expand", { path: root + "/a-target" });
  const original = root + "/a-target/external.txt";
  await page
    .locator('.tree-row[title="' + original + '"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await until(async () => !!(await state()).fileClipboard);
  await page
    .locator('.tree-row[title="' + root + '/a-target"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await until(() => fs.existsSync(root + "/a-target/external copy.txt"));
  assert.equal(
    fs.readFileSync(root + "/a-target/external copy.txt", "utf8"),
    "external drop",
  );
  await cmd("file.cut", { path: original });
  await until(
    async () => (await page.locator(".tree-row.cut-item").count()) === 1,
  );
  await cmd("file.paste", { directory: root });
  confirm = (await state()).confirmation;
  await cmd("confirmation.accept", { token: confirm.token });
  assert.equal((await state()).fileClipboard, null);
  assert.ok(fs.existsSync(root + "/external.txt") && !fs.existsSync(original));
  await cmd("file.copy", { path: root + "/a-target" });
  await cmd("file.paste", { directory: root });
  assert.equal(
    fs.readFileSync(root + "/a-target copy/external copy.txt", "utf8"),
    "external drop",
  );
  await cmd("file.copy", { path: root + "/external.txt" });
  fs.writeFileSync(root + "/external.txt", "changed after copying");
  await assert.rejects(
    cmd("file.paste", { directory: root + "/a-target" }),
    /changed/i,
  );
  results.push(
    "Right-click Copy/Paste duplicates, Cut/Paste moves with confirmation and clears cut styling, folder copies, stale clipboard rejection",
  );
  await cmd("settings.update", { key: "files.quickOpenMaxDepth", value: 0 });
  await cmd("settings.save");
  await cmd("file.index.refresh");
  await until(async () => !(await cmd("file.search", { query: "" })).loading);
  assert.equal((await cmd("file.search", { query: "rdpl" })).matches.length, 0);
  await page.screenshot({ path: path.join(base, "file-workspace.png") });
  console.log(
    JSON.stringify(
      { passed: results.length, results, artifacts: base },
      null,
      2,
    ),
  );
})()
  .catch(async (error) => {
    console.error(error);
    if (page)
      await page
        .screenshot({ path: path.join(base, "failure.png") })
        .catch(() => {});
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
