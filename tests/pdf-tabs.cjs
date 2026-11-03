const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pdfFixture } = require("./pdf-fixture.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/pdf-tabs-"));
const file = path.join(base, "Review.PDF").replaceAll("\\", "/");
fs.writeFileSync(file, pdfFixture());
for (const name of ["dirty.txt", "saved.txt"])
  fs.writeFileSync(path.join(base, name), name);
fs.writeFileSync(path.join(base, "broken.pdf"), "%PDF-1.4\nbroken");
let app;
async function until(page, fn, arg) {
  const started = Date.now();
  while (!(await page.evaluate(fn, arg))) {
    if (Date.now() - started > 30000)
      throw Error("Timed out waiting for PDF/tab state");
    await page.waitForTimeout(80);
  }
}
(async () => {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", base],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (p, id, args = {}) =>
    p.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd(page, "workspace.state", { readOnly: true });
  assert.equal(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((r) => /PdfViewer|pdf\.worker/.test(r.name)),
    ),
    false,
  );
  await cmd(page, "terminal.toggle", { visible: false });
  await cmd(page, "file.open", { path: file });
  await page.locator('.pdf-viewer[data-rendered="true"]').waitFor();
  assert.equal((await cmd(page, "pdf.state")).pages, 2);
  assert.match(
    await page.locator(".textLayer").innerText(),
    /Owlet PDF review/,
  );
  assert.equal(await page.evaluate(() => globalThis.__pdfScriptRan), undefined);
  await page
    .locator(".textLayer span")
    .first()
    .evaluate((el) => {
      const selection = window.getSelection(),
        range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page.locator(".textLayer span").first().click({ button: "right" });
  await page
    .getByRole("menu", { name: "Text actions" })
    .getByRole("menuitem", { name: "Copy", exact: true })
    .click();
  await until(page, async () =>
    (await navigator.clipboard.readText()).includes("Owlet PDF review"),
  );
  await page.screenshot({ path: path.join(base, "pdf.png") });
  await page
    .getByRole("button", { name: "Next PDF page", exact: true })
    .click();
  await until(page, async () => {
    const s = await window.owletCommands.execute("pdf.state");
    return s.page === 2 && s.rendered && s.text.includes("Second page");
  });
  await cmd(page, "pdf.copyPageText");
  assert.match(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    /Second page/,
  );
  await cmd(page, "pdf.actualSize");
  await cmd(page, "pdf.zoomIn");
  assert.equal((await cmd(page, "pdf.state")).zoom, 1.25);
  await page.locator(".pdf-scroll").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Control+0");
  assert.equal((await cmd(page, "pdf.state")).zoom, 1);
  await page.keyboard.press("Control+=");
  assert.equal((await cmd(page, "pdf.state")).zoom, 1.25);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await until(
    page,
    async () => (await window.owletCommands.execute("pdf.state")).zoom === 1.5,
  );
  await cmd(page, "pdf.fitWidth");
  assert.equal((await cmd(page, "pdf.state")).zoom, "fit");
  await assert.rejects(cmd(page, "pdf.page", { page: 999 }), /Choose a page/);
  await cmd(page, "pdf.page", { page: 1 });
  await until(page, async () => {
    const s = await window.owletCommands.execute("pdf.state");
    return s.rendered && s.page === 1;
  });
  // Tabs have a dedicated menu, and splits target the clicked tab.
  await page
    .getByRole("tab", { name: /Review.PDF/ })
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Tab actions" });
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
    "Copy Path",
    "Copy Relative Path",
    "Split Right",
    "Split Left",
    "Show in Explorer",
    "Close All Saved Tabs",
  ]);
  await menu
    .getByRole("menuitem", { name: "Copy Relative Path", exact: true })
    .click();
  await until(
    page,
    async () => (await navigator.clipboard.readText()) === "Review.PDF",
  );
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "Review.PDF",
  );
  await page
    .getByRole("tab", { name: /Review.PDF/ })
    .click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Split Left", exact: true }).click();
  await page.locator('[data-pdf-group="2"][data-rendered="true"]').waitFor();
  assert.equal(
    await page.locator(".editor-group").first().getAttribute("data-group"),
    "2",
  );
  await cmd(page, "pdf.page", { group: 2, page: 2 });
  assert.equal((await cmd(page, "pdf.state", { group: 1 })).page, 1);
  await cmd(page, "explorer.toggle");
  await cmd(page, "tab.reveal", { path: file, group: 1 });
  assert.equal((await state()).sidebar.visible, true);
  await page
    .locator('[data-group="2"]')
    .getByRole("tab", { name: /Review.PDF/ })
    .click({ button: "middle" });
  assert.equal(await page.locator(".pdf-viewer").count(), 1);
  const dirty = base.replaceAll("\\", "/") + "/dirty.txt",
    saved = base.replaceAll("\\", "/") + "/saved.txt";
  await cmd(page, "file.open", { path: dirty });
  await cmd(page, "editor.setText", { path: dirty, text: "unsaved work" });
  await cmd(page, "file.open", { path: saved });
  await page
    .getByRole("tab", { name: /^dirty.txt/ })
    .click({ button: "middle" });
  assert.match((await state()).confirmation.title, /Discard changes/);
  await cmd(page, "confirmation.cancel");
  await page
    .getByRole("tab", { name: /^saved.txt/ })
    .click({ button: "middle" });
  assert.equal(await page.getByRole("tab", { name: /^saved.txt/ }).count(), 0);
  await cmd(page, "file.open", { path: saved });
  const terminal = (await state()).terminal.sessions[0].id;
  await cmd(page, "terminal.moveToEditor", { id: terminal });
  await cmd(page, "tab.activate", { path: saved });
  await page
    .getByRole("tab", { name: /^saved.txt/ })
    .click({ button: "right" });
  await page.screenshot({ path: path.join(base, "tab-menu.png") });
  await menu
    .getByRole("menuitem", { name: "Close All Saved Tabs", exact: true })
    .click();
  assert.equal(await page.getByRole("tab").count(), 2);
  assert.equal(
    await page.locator(`[data-terminal-tab="${terminal}"]`).count(),
    1,
  );
  await page
    .locator(`[data-terminal-tab="${terminal}"]`)
    .click({ button: "middle" });
  assert(
    (await state()).confirmation,
    "Middle-click must confirm closing a running shell",
  );
  await cmd(page, "confirmation.cancel");
  await cmd(page, "terminal.moveToPanel", { id: terminal });
  await cmd(page, "tab.activate", { path: dirty });
  assert.equal(
    (await cmd(page, "file.inspect", { path: dirty, readOnly: true })).text,
    "unsaved work",
  );
  await cmd(page, "file.open", {
    path: base.replaceAll("\\", "/") + "/broken.pdf",
  });
  await page.locator(".pdf-error").waitFor();
  assert.match(
    await page.locator(".pdf-error").innerText(),
    /Could not open PDF/,
  );
  await cmd(page, "file.close");
  assert.equal(fs.readFileSync(file).equals(pdfFixture()), true);
  // Reload changed PDFs, without re-downloading unchanged files on every poll.
  await cmd(page, "file.open", { path: file });
  await page.locator('.pdf-viewer[data-rendered="true"]').waitFor();
  fs.writeFileSync(file, pdfFixture("Updated PDF"));
  await until(page, async () =>
    (await window.owletCommands.execute("pdf.state")).text.includes(
      "Updated PDF",
    ),
  );
  if (process.env.OWLET_SSH_TARGET) {
    const { python, target } = require("./fixture.cjs");
    const remoteRoot = python(
      `import tempfile,pathlib,base64; p=pathlib.Path(tempfile.mkdtemp(prefix='owlet-pdf-')); (p/'Review.pdf').write_bytes(base64.b64decode('${pdfFixture().toString("base64")}')); print(p)`,
    );
    try {
      const next = app.waitForEvent("window");
      await cmd(page, "workspace.openSSH", { target, path: remoteRoot });
      const remote = await next;
      await remote.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
      await cmd(remote, "file.open", { path: remoteRoot + "/Review.pdf" });
      await remote.locator('.pdf-viewer[data-rendered="true"]').waitFor();
      assert.equal((await cmd(remote, "pdf.state")).pages, 2);
      await cmd(remote, "pdf.nextPage");
      await until(remote, async () => {
        const s = await window.owletCommands.execute("pdf.state");
        return s.page === 2 && s.rendered;
      });
      await cmd(remote, "pdf.copyPageText");
      assert.match(
        await app.evaluate(({ clipboard }) => clipboard.readText()),
        /Second page/,
      );
    } finally {
      if (/^\/tmp\/owlet-pdf-[\w-]+$/.test(remoteRoot))
        python(`import shutil; shutil.rmtree(${JSON.stringify(remoteRoot)})`);
    }
  }
  assert(
    !errors.some((e) =>
      /Content Security Policy|worker.*failed|Uncaught/.test(e),
    ),
    errors.join("\n"),
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        ssh: !!process.env.OWLET_SSH_TARGET,
        errors,
        checks: [
          "Lazy PDF renderer, text selection layer, pages/zoom/copy, inert document scripts",
          "Independent split viewers, external PDF refresh, invalid PDF error",
          "Tab context menu, targeted split left/reveal, middle-click dirty guard, close saved tabs",
          "Local and configured SSH PDF rendering",
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
