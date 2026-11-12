const { _electron } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/project-search-ui-"));
const remote = !!process.env.OWLET_SSH_TARGET,
  fixture = remote ? require("./fixture.cjs") : null;
const root = remote
  ? fixture.python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-search-ui-"))',
    )
  : path.join(base, "workspace").replaceAll("\\", "/");
const files = {
  "notes.md": "# Reading\n\n😀 中文 needle and detail\n",
  "nested/agent.md": "# Agent notes\n\nneedle to find\n",
  "many.txt": "needle line\n".repeat(500),
  "ignored.txt": "needle ignore\n",
  ".ignore": "ignored.txt\n",
};
if (remote) {
  const script = Buffer.from(
    `import os,sys,json\nr=${JSON.stringify(root)}\nfor name,text in json.load(sys.stdin).items():\n p=os.path.join(r,name);os.makedirs(os.path.dirname(p),exist_ok=True);open(p,'w',encoding='utf8').write(text)`,
  ).toString("base64");
  require("node:child_process").execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      fixture.target,
      `python3 -c "import base64;exec(base64.b64decode('${script}'))"`,
    ],
    { input: JSON.stringify(files), windowsHide: true, timeout: 30000 },
  );
} else
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(root + "/" + name), { recursive: true });
    fs.writeFileSync(root + "/" + name, text);
  }
let app, page;
async function until(fn) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 30000) throw Error("Timed out");
    await new Promise((r) => setTimeout(r, 60));
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
      ...(remote ? { LWR_ROOT: root, LWR_SSH_TARGET: fixture.target } : {}),
    },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd("search.inspect", { readOnly: true });
  await page.locator('[data-ready="true"]').waitFor();
  await page.keyboard.press("Control+Shift+f");
  const input = page.getByRole("textbox", {
    name: "Search project text",
    exact: true,
  });
  await input.waitFor();
  assert.ok(await input.evaluate((el) => document.activeElement === el));
  await input.fill("needle");
  await until(async () => (await state()).status === "complete");
  assert.equal((await state()).matches.length, 502);
  assert.ok(
    (await page.locator(".project-result-line").count()) < 70,
    "results are virtualized",
  );
  await page
    .getByRole("textbox", { name: "Files to include", exact: true })
    .fill("*.md");
  await page.keyboard.press("Enter");
  await until(
    async () =>
      (await state()).status === "complete" &&
      (await state()).matches.length === 2,
  );
  await page.screenshot({ path: path.join(base, "search-sidebar.png") });
  const result = (await state()).matches.findIndex((item) =>
    item.path.endsWith("notes.md"),
  );
  await cmd("search.openResult", { index: result });
  const selection = await page.locator(".cm-editor").evaluate((el) => {
    const view = el.cmView?.view;
    return view
      ? view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        )
      : window.getSelection()?.toString();
  });
  assert.equal(
    selection,
    "needle",
    "navigation selects the match after Unicode characters",
  );
  assert.equal(
    (await cmd("file.inspect", { readOnly: true })).path,
    root + "/notes.md",
  );
  assert.equal(await page.locator(".cm-editor").count(), 1);
  assert.ok(
    await input.isVisible(),
    "result navigation retains Search sidebar",
  );
  await cmd("explorer.show");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+f");
  await input.waitFor();
  assert.ok(
    await input.evaluate((el) => document.activeElement === el),
    "shortcut works from source editor",
  );
  await cmd("explorer.show");
  await cmd("terminal.focus");
  await page.keyboard.press("Control+Shift+f");
  await input.waitFor();
  assert.ok(
    await input.evaluate((el) => document.activeElement === el),
    "shortcut works from terminal",
  );
  await cmd("editor.setText", { text: "unsaved needle" });
  await page
    .getByText("Unsaved changes are not included.", { exact: true })
    .waitFor();
  assert.equal(
    await cmd("search.openResult", { index: result }),
    false,
    "stale line does not select unrelated dirty text",
  );
  await cmd("file.reload", { path: root + "/notes.md", discard: true });
  await cmd("search.run", {
    query: "needle",
    include: "many.txt",
    maxResults: 5,
  });
  await until(async () => (await state()).status === "limited");
  assert.equal((await state()).matches.length, 5);
  await page
    .getByRole("button", { name: "Rerun with higher limits", exact: true })
    .click();
  await until(
    async () =>
      (await state()).status === "limited" &&
      (await state()).matches.length === 10,
  );
  await cmd("search.run", { query: "absent-text", include: "" });
  await until(async () => (await state()).status === "complete");
  assert.equal((await state()).matches.length, 0);
  await cmd("explorer.show");
  const folder = page.locator(`.tree-row[title="${root}/nested"]`);
  await folder.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Find in Folder…", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Search folder", exact: true })
      .inputValue(),
    root + "/nested",
  );
  await cmd("search.run", { query: "needle" });
  await until(async () => (await state()).status === "complete");
  assert.equal((await state()).matches.length, 1);
  await cmd("search.run", {
    directory: "",
    query: "needle",
    include: "many.txt",
    maxResults: 10000,
  });
  await cmd("search.run", { query: "absent-new-query" });
  await until(async () => (await state()).status === "complete");
  assert.equal(
    (await state()).matches.length,
    0,
    "old results cannot leak into a newer query",
  );
  await cmd("search.clear");
  assert.equal((await state()).status, "idle");
  await cmd("search.run", {
    query: "needle",
    include: "many.txt",
    maxResults: 10000,
  });
  await page.getByRole("button", { name: "Stop search", exact: true }).click();
  assert.equal((await state()).status, "stopped");
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Find in Project");
  await page.getByRole("option").first().click();
  assert.ok(await input.isVisible());
  console.log(
    JSON.stringify({
      passed: true,
      remote,
      base,
      selection,
      checks: [
        "shortcut and palette",
        "live search",
        "virtualized results",
        "Unicode navigation",
        "dirty buffer safety",
        "partial limits and rerun",
        "folder context menu",
        "latest query wins",
      ],
    }),
  );
})()
  .catch(async (error) => {
    if (page)
      await page
        .screenshot({ path: path.join(base, "failure.png") })
        .catch(() => {});
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
    if (remote && /^\/tmp\/owlet-search-ui-[\w-]+$/.test(root))
      fixture.python(`import shutil;shutil.rmtree(${JSON.stringify(root)})`);
  });
