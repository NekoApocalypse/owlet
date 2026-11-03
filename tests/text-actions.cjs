const { _electron } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const root = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(root, "artifacts/text-actions-")),
  file = path.join(base, "Sample.txt").replaceAll("\\", "/"),
  md = path.join(base, "Reading.md").replaceAll("\\", "/");
const text = "alpha bravo charlie delta\nsecond line\n";
fs.writeFileSync(file, text);
fs.writeFileSync(md, "# Reading\n\nCopy this **preview phrase**.\n");
let app;
(async () => {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", base],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  async function until(predicate) {
    const started = Date.now();
    while (!(await predicate())) {
      if (Date.now() - started > 10000)
        throw Error("Timed out waiting for clipboard action");
      await page.waitForTimeout(50);
    }
  }
  await cmd("terminal.toggle", { visible: false });
  await cmd("file.open", { path: file });
  async function point(at) {
    return page
      .locator(".active-group .cm-line")
      .first()
      .evaluate((el, at) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n = walker.nextNode();
        while (n && at > n.textContent.length) {
          at -= n.textContent.length;
          n = walker.nextNode();
        }
        const range = document.createRange();
        range.setStart(n, at);
        range.collapse(true);
        const r = range.getBoundingClientRect();
        return { x: r.x + 0.1, y: r.y + r.height / 2 };
      }, at);
  }
  async function drag(from, to) {
    const a = await point(from),
      b = await point(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
  }
  async function menu(name) {
    await page
      .locator(".active-group .cm-line")
      .first()
      .click({ button: "right", position: { x: 80, y: 10 } });
    await page
      .getByRole("menu", { name: "Text actions" })
      .getByRole("menuitem", { name, exact: true })
      .click();
  }
  for (const vim of [false, true]) {
    await cmd("settings.update", { key: "editor.vimMode", value: vim });
    await cmd("settings.save");
    await cmd("tab.activate", { path: file });
    await cmd("editor.setText", { path: file, text });
    await drag(0, 11);
    await drag(6, 11); // Second gesture starts inside the first selection.
    assert.equal(
      (await cmd("file.inspect", { path: file, readOnly: true })).text,
      text,
      "Dragging must never change text",
    );
    await menu("Copy");
    await until(async () => (await clipboard()) === "bravo");
    assert.equal(await clipboard(), "bravo");
    await menu("Cut");
    await until(
      async () =>
        (await cmd("file.inspect", { path: file, readOnly: true })).text ===
        "alpha  charlie delta\nsecond line\n",
    );
    assert.equal(await clipboard(), "bravo");
    assert.equal(
      (await cmd("file.inspect", { path: file, readOnly: true })).text,
      "alpha  charlie delta\nsecond line\n",
    );
    await menu("Paste");
    await until(
      async () =>
        (await cmd("file.inspect", { path: file, readOnly: true })).text ===
        text,
    );
    assert.equal(
      (await cmd("file.inspect", { path: file, readOnly: true })).text,
      text,
    );
    await cmd("editor.undo");
    assert.equal(
      (await cmd("file.inspect", { path: file, readOnly: true })).text,
      "alpha  charlie delta\nsecond line\n",
    );
    await cmd("editor.setText", { path: file, text });
  }
  await cmd("file.open", { path: md });
  await page.locator(".markdown-preview strong").waitFor();
  await page.locator(".markdown-preview strong").evaluate((el) => {
    const s = window.getSelection(),
      r = document.createRange();
    r.selectNodeContents(el);
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.locator(".markdown-preview strong").click({ button: "right" });
  const previewMenu = page.getByRole("menu", { name: "Text actions" });
  await previewMenu.waitFor({ state: "visible" });
  assert.equal(await previewMenu.getByRole("menuitem").count(), 1);
  // Give the Electron compositor a frame before capturing the review artifact.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: path.join(base, "preview-menu.png") });
  await previewMenu
    .getByRole("menuitem", { name: "Copy", exact: true })
    .click();
  await until(async () => (await clipboard()) === "preview phrase");
  assert.equal(await clipboard(), "preview phrase");
  await cmd("tab.activate", { path: file });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page
    .locator(".cm-line")
    .first()
    .click({ button: "right", position: { x: 10, y: 10 } });
  assert(
    await page.getByRole("menuitem", { name: "Cut", exact: true }).isDisabled(),
  );
  await page.screenshot({ path: path.join(base, "editor-menu.png") });
  await page.keyboard.press("Escape");
  // A command targeting the source pane must work even with a preview focused.
  await cmd("group.splitRight");
  await cmd("file.open", { path: md });
  await cmd("group.focus", { group: 1 });
  await cmd("editor.selectAll");
  await cmd("group.focus", { group: 2 });
  await cmd("editor.copy", { group: 1, path: file });
  assert.equal((await clipboard()).replace(/\r\n/g, "\n"), text);
  await app.evaluate(({ clipboard }) => clipboard.writeText("one\r\ntwo"));
  await cmd("editor.paste", { group: 1, path: file });
  const pasted = await cmd("file.inspect", { path: file, readOnly: true });
  assert.equal(pasted.text, "one\ntwo");
  assert.equal(pasted.dirty, true);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    text,
    "Clipboard edits must remain unsaved",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "Mouse drag selects without mutation in normal and Vim mode",
          "Editor menu Copy/Cut/Paste uses selection; edits undo normally",
          "Preview menu copies selected formatted text only",
          "Empty selections disable destructive clipboard actions",
          "Clipboard commands target inactive source panes and normalize Windows line endings",
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
