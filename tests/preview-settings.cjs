const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(
  path.join(workspace, "artifacts", "preview-settings-"),
);
const root = path.join(base, "Owlet review"),
  profile = path.join(base, "profile");
fs.mkdirSync(root);
fs.mkdirSync(profile);
const file = path.join(root, "Reading.md").replaceAll("\\", "/");
const settingsPath = "owlet://user/settings.json";
const markdown =
  '# A clearer `view`\n\nFind the right detail without leaving the preview.\n\n## A familiar `workspace`\n\nA quiet **watchful owl** reads the plan. A watchful owl notices the implementation.\n\nLiteral a+b and 中文 are searchable.\n\n```js\nconst result = "watchful owl";\n```\n\n$\\text{mathonly}$\n\n```mermaid\nflowchart LR\n A[diagramonly] --> B[Review]\n```\n\n' +
  Array.from({ length: 45 }, (_, i) => `Paragraph ${i}: reading room.\n`).join(
    "\n",
  ) +
  "\nLast watchful owl.\n";
fs.writeFileSync(file, markdown);
fs.writeFileSync(
  path.join(profile, "settings.json"),
  '{\n  // Keep this comment\n  "future.setting": "preserve",\n}\n',
);
const results = [];
let app;
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
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}, target = page) =>
    target.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd("workspace.state", { readOnly: true });
  async function until(fn) {
    const start = Date.now();
    while (!(await fn())) {
      if (Date.now() - start > 15000)
        throw Error("Timed out waiting for state");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await until(
    async () => (await state()).terminal.sessions?.[0]?.status === "running",
  );
  const pty = (await state()).terminal.sessions[0].pty;
  await cmd("terminal.toggle");
  await cmd("file.open", { path: file });
  await page.locator(".diagram svg").waitFor();
  const font = await page
    .locator("h1 code")
    .evaluate((el) => [
      getComputedStyle(el).fontSize,
      getComputedStyle(el.parentElement).fontSize,
    ]);
  assert.equal(font[0], font[1]);
  await page.locator(".markdown-preview").focus();
  await page.keyboard.press("Control+f");
  await page
    .getByRole("textbox", { name: "Find in preview", exact: true })
    .fill("watchful owl");
  await until(async () => (await cmd("preview.findState")).matches === 4);
  assert.equal(await page.locator(".cm-editor").count(), 0);
  assert.equal(await page.locator("mark.preview-match").count(), 4);
  await page.keyboard.press("Enter");
  assert.equal((await cmd("preview.findState")).current, 2);
  await page.keyboard.press("Shift+Enter");
  assert.equal((await cmd("preview.findState")).current, 1);
  await cmd("preview.find", { search: "quiet watchful owl" });
  await until(async () => (await cmd("preview.findState")).matches === 1);
  assert.equal(await page.locator("mark.preview-match").count(), 2);
  for (const query of ["a+b", "中文"]) {
    await cmd("preview.find", { search: query });
    await until(async () => (await cmd("preview.findState")).matches === 1);
  }
  for (const query of ["mathonly", "diagramonly"]) {
    await cmd("preview.find", { search: query });
    await until(async () => (await cmd("preview.findState")).matches === 0);
  }
  assert.equal(await page.locator(".katex mark,.diagram mark").count(), 0);
  await cmd("preview.closeFind");
  assert.equal(await page.locator("mark.preview-match").count(), 0);
  results.push(
    "Scoped literal preview find, formatted phrase counting, keyboard navigation, math/diagram exclusion, clean close",
  );
  await cmd("group.splitRight");
  const group = (await state()).activeGroup;
  await cmd("file.open", { path: file, group });
  await until(
    async () => (await page.locator(".markdown-preview").count()) === 2,
  );
  await page.locator(`[data-preview-group="${group}"] article`).focus();
  await page.keyboard.press("Control+=");
  await until(async () => (await state()).previewZoom === 1.1);
  assert.deepEqual(
    await page
      .locator(".markdown-preview")
      .evaluateAll((items) => items.map((el) => el.style.zoom)),
    ["1.1", "1.1"],
  );
  await page.keyboard.press("Control+-");
  assert.equal((await state()).previewZoom, 1);
  await page.locator(`[data-preview-group="${group}"] article`).hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await until(async () => (await state()).previewZoom === 1.1);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
    1,
  );
  await page.keyboard.press("Control+0");
  await until(async () => (await state()).previewZoom === 1);
  // Selecting a preview tab leaves keyboard focus on its tab button.
  const activeTab = page.locator(`[data-group="${group}"] .tab.active-tab`);
  await activeTab.click();
  await activeTab.focus();
  await page.keyboard.press("Control+Shift+=");
  await until(async () => (await state()).previewZoom === 1.1);
  await page.keyboard.press("Control+-");
  await until(async () => (await state()).previewZoom === 1);
  await page.keyboard.press("Control+NumpadAdd");
  await until(async () => (await state()).previewZoom === 1.1);
  await page.keyboard.press("Control+NumpadSubtract");
  await until(async () => (await state()).previewZoom === 1);
  await page.locator(".tree-row").filter({ hasText: "Reading.md" }).click();
  await page.keyboard.press("Control+=");
  await until(async () => (await state()).previewZoom === 1.1);
  await page.keyboard.press("Control+0");
  await until(async () => (await state()).previewZoom === 1);
  assert.deepEqual(
    await page
      .locator(".markdown-preview")
      .evaluateAll((items) => items.map((el) => el.style.zoom)),
    ["1", "1"],
  );
  await cmd("commands.show");
  await page.keyboard.press("Control+=");
  assert.equal(
    (await state()).previewZoom,
    1,
    "Palette input keeps its own shortcuts",
  );
  await page.keyboard.press("Escape");
  await cmd("preview.zoom.in");
  await cmd("markdown.both", { path: file, group });
  await page.locator(`[data-group="${group}"] .cm-content`).focus();
  await page.keyboard.press("Control+0");
  assert.equal(
    (await state()).previewZoom,
    1.1,
    "Source editor owns its keys in split preview mode",
  );
  await cmd("terminal.focus");
  await page.keyboard.press("Control+-");
  assert.equal(
    (await state()).previewZoom,
    1.1,
    "Terminal focus must not zoom the preview",
  );
  await cmd("terminal.toggle", { visible: false });
  await cmd("markdown.preview", { path: file, group });
  await cmd("preview.zoom.reset");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
    1,
  );
  await cmd("preview.find", { group, search: "watchful owl" });
  await until(
    async () => (await cmd("preview.findState", { group })).matches === 4,
  );
  assert.equal((await cmd("preview.findState", { group: 1 })).open, false);
  fs.writeFileSync(file, markdown + "\nAnother watchful owl.\n");
  await until(
    async () => (await cmd("preview.findState", { group })).matches === 5,
  );
  await page.screenshot({ path: path.join(base, "preview-find.png") });
  await cmd("preview.closeFind", { group });
  results.push(
    "Shared preview-only keyboard/wheel zoom, independent find per pane, external file refresh",
  );
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.locator(".settings-view").waitFor();
  await page
    .getByRole("textbox", { name: "Search settings" })
    .fill("font size");
  assert.equal(
    await page.locator('.setting-row[data-setting$=".fontSize"]').count(),
    3,
  );
  await page.locator('[data-setting="preview.fontSize"] input').fill("18");
  assert.equal((await cmd("settings.inspect")).values["preview.fontSize"], 14);
  assert.ok(await page.locator(".tab.active-tab .dirty-dot").count());
  await page
    .getByRole("button", { name: "Settings JSON", exact: true })
    .click();
  await page.locator(".cm-editor").waitFor();
  const buffer = await cmd("file.inspect", {
    path: settingsPath,
    readOnly: true,
  });
  assert.match(buffer.text, /Keep this comment/);
  assert.match(buffer.text, /future.setting/);
  assert.match(buffer.text, /preview.fontSize/);
  await page.keyboard.press("Control+s");
  await until(
    async () =>
      (await cmd("settings.inspect")).values["preview.fontSize"] === 18,
  );
  assert.equal(
    await page
      .locator(".markdown-preview")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "18px",
  );
  await cmd("settings.update", { key: "editor.fontSize", value: 17 });
  await cmd("settings.update", { key: "terminal.fontSize", value: 16 });
  await cmd("settings.update", { key: "editor.wordWrap", value: false });
  assert.equal(await cmd("settings.save"), true);
  assert.equal(
    await page
      .locator(".cm-editor")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "17px",
  );
  assert.equal(await page.locator(".cm-lineWrapping").count(), 0);
  assert.equal((await state()).terminal.sessions[0].pty, pty);
  await cmd("terminal.toggle");
  await page.waitForFunction(() => {
    const s = document.querySelector(".xterm-screen").getBoundingClientRect(),
      m = document.querySelector(".terminal-mount").getBoundingClientRect();
    return s.height > 0 && s.bottom <= m.bottom + 1;
  });
  await cmd("terminal.toggle");
  await cmd("settings.open");
  await page
    .getByRole("textbox", { name: "Search settings" })
    .fill("font size");
  await page.screenshot({ path: path.join(base, "settings-ui.png") });
  await cmd("settings.json");
  await page.screenshot({ path: path.join(base, "settings-json.png") });
  results.push(
    "Settings gear, search, UI/JSON shared dirty buffer, JSONC preservation, explicit Save, live editor/preview/terminal settings without PTY restart",
  );
  const disk = fs.readFileSync(path.join(profile, "settings.json"), "utf8");
  await cmd("editor.setText", {
    path: settingsPath,
    text: '{"editor.fontSize":-2}',
  });
  assert.equal(await cmd("settings.save"), false);
  assert.equal(
    fs.readFileSync(path.join(profile, "settings.json"), "utf8"),
    disk,
  );
  await cmd("editor.setText", {
    path: settingsPath,
    text: '{"editor.fontSize":19}',
  });
  fs.writeFileSync(
    path.join(profile, "settings.json"),
    '{"editor.fontSize":20}',
  );
  assert.equal(await cmd("settings.save"), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8"))[
      "editor.fontSize"
    ],
    20,
  );
  const conflict = (await state()).documents.find(
    (d) => d.path === settingsPath,
  );
  assert.ok(conflict.conflictRevision);
  await cmd("conflict.useRemote", {
    path: settingsPath,
    confirmed: true,
    revision: conflict.conflictRevision,
  });
  await until(
    async () =>
      (await cmd("settings.inspect")).values["editor.fontSize"] === 20,
  );
  await cmd("settings.reset", { key: "editor.fontSize" });
  await cmd("settings.save");
  assert.equal((await cmd("settings.inspect")).values["editor.fontSize"], 13);
  results.push(
    "Invalid saves rejected, external config changes applied, dirty config conflict comparison, per-setting reset",
  );
  await cmd("window.newEmpty");
  await until(async () => app.windows().length === 2);
  const second = app.windows().find((p) => p !== page);
  await second.waitForFunction(() => !!window.owletCommands);
  await until(
    async () =>
      (await cmd("settings.inspect", {}, second)).values["editor.fontSize"] ===
      13,
  );
  await cmd("settings.update", { key: "preview.fontSize", value: 22 });
  await cmd("settings.save");
  await until(
    async () =>
      (await cmd("settings.inspect", {}, second)).values["preview.fontSize"] ===
      22,
  );
  results.push(
    "User preferences synchronize across windows, including an empty local window",
  );
  await cmd("tab.activate", { path: file, group });
  await cmd("markdown.source", { path: file, group });
  await page.locator(`[data-group="${group}"] .cm-content`).focus();
  await page.keyboard.press("Control+f");
  await page.locator(`[data-group="${group}"] .cm-search`).waitFor();
  await cmd("editor.closeFind");
  await cmd("markdown.preview", { path: file, group });
  fs.writeFileSync(file, "# Bounded search\n\n" + "needle ".repeat(1005));
  await page
    .locator(`[data-preview-group="${group}"] h1`)
    .filter({ hasText: "Bounded search" })
    .waitFor();
  await cmd("preview.find", { group, search: "needle" });
  await until(async () => (await cmd("preview.findState", { group })).limited);
  assert.equal((await cmd("preview.findState", { group })).matches, 1000);
  await cmd("preview.closeFind", { group });
  for (let i = 0; i < 20; i++) await cmd("preview.zoom.in");
  assert.equal((await state()).previewZoom, 3);
  for (let i = 0; i < 20; i++) await cmd("preview.zoom.out");
  assert.equal((await state()).previewZoom, 0.5);
  await cmd("preview.zoom.reset");
  await cmd("settings.update", {
    key: "markdown.defaultView",
    value: "source",
  });
  await cmd("settings.save");
  const fresh = path.join(root, "Fresh.md").replaceAll("\\", "/");
  fs.writeFileSync(fresh, "# Default source\n");
  await cmd("file.open", { path: fresh, group });
  await page.locator(`[data-group="${group}"] .cm-editor`).waitFor();
  results.push(
    "Source Ctrl+F preserved, 1,000-match cap, zoom bounds, saved default Markdown view",
  );
  fs.writeFileSync(
    path.join(workspace, "artifacts/preview-settings-results.json"),
    JSON.stringify({ status: "passed", base, results }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", base, results }, null, 2));
})()
  .catch((error) => {
    console.error(error);
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
