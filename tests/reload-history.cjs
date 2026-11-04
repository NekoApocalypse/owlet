const { _electron } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pdfFixture } = require("./pdf-fixture.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/reload-history-")),
  root = path.join(base, "Project").replaceAll("\\", "/"),
  profile = path.join(base, "profile");
fs.mkdirSync(root);
for (const [name, text] of [
  ["boot.md", "# Initial CLI file"],
  ["plan.md", "# Plan\n\nRead this fresh."],
  ["note.txt", "saved note"],
  ["gone.txt", "will disappear"],
])
  fs.writeFileSync(root + "/" + name, text);
fs.writeFileSync(root + "/review.pdf", pdfFixture());
fs.copyFileSync(path.resolve("assets/icon.png"), root + "/owl.png");
const settings = "owlet://user/settings.json";
let app, page;
let remoteRoot;
const cmd = (id, args = {}, p = page) =>
  p.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
const state = (p = page) => cmd("workspace.state", { readOnly: true }, p);
const groupList = (n) =>
  n.kind === "group"
    ? [n.group]
    : [...groupList(n.first), ...groupList(n.second)];
async function until(fn) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 30000)
      throw Error("Timed out waiting for restored state");
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function launch() {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root + "/boot.md"],
        }
      : { args: [path.resolve("."), "--local", root + "/boot.md"] }),
    env: { ...process.env, OWLET_USER_DATA: profile },
  });
  page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  await until(async () =>
    (await state()).documents.some(
      (d) => d.path === root + "/boot.md" && !d.loading,
    ),
  );
}
async function stop() {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close().catch(() => {});
    app = null;
  }
}
async function reload() {
  const loaded = page.waitForEvent("load");
  await cmd("window.reload").catch((e) => {
    if (!/context|destroyed|closed/i.test(String(e))) throw e;
  });
  await loaded;
  await page.locator('[data-ready="true"]').waitFor();
  await until(async () => !(await state()).documents.some((d) => d.loading));
}
async function palette(title) {
  await cmd("commands.show");
  await page.getByRole("textbox", { name: "Search commands" }).fill(title);
  await page.getByRole("option").filter({ hasText: title }).first().click();
}
(async () => {
  await launch();
  await cmd("file.close", { path: root + "/boot.md", group: 1 });
  for (const name of [
    "plan.md",
    "note.txt",
    "gone.txt",
    "review.pdf",
    "owl.png",
  ])
    await cmd("file.open", { path: root + "/" + name, group: 1 });
  await cmd("group.splitRight", { group: 1, path: root + "/plan.md" });
  const group = (await state()).activeGroup;
  await cmd("markdown.both", { path: root + "/plan.md", group: 1 });
  await cmd("markdown.source", { path: root + "/plan.md", group });
  await cmd("settings.json", { group });
  await cmd("explorer.setWidth", { width: 310 });
  await cmd("preview.zoom.in");
  await until(
    async () => (await state()).terminal.sessions[0]?.status === "running",
  );
  const terminal = (await state()).terminal.sessions[0];
  await cmd("terminal.rename", { id: terminal.id, name: "Agent shell" });
  await cmd("terminal.moveToEditor", { id: terminal.id, group: 1 });
  await cmd("terminal.new");
  await cmd("tab.activate", { path: root + "/note.txt", group: 1 });
  await cmd("tab.activate", { path: settings, group });
  await cmd("editor.setText", {
    path: root + "/note.txt",
    text: "unsaved edits",
  });
  const before = await state();
  await app.evaluate(({ dialog }) => {
    globalThis.__reloadResponse = 0;
    dialog.showMessageBox = async () => ({
      response: globalThis.__reloadResponse,
    });
  });
  assert.equal(await cmd("window.reload"), false);
  assert.equal(
    (await cmd("file.inspect", { path: root + "/note.txt", readOnly: true }))
      .text,
    "unsaved edits",
  );
  fs.writeFileSync(root + "/note.txt", "fresh disk note");
  fs.unlinkSync(root + "/gone.txt");
  await app.evaluate(() => (globalThis.__reloadResponse = 1));
  await reload();
  const after = await state();
  assert.deepEqual(after.layout, before.layout);
  assert.equal(after.activeGroup, before.activeGroup);
  assert.deepEqual(after.viewModes, before.viewModes);
  assert.equal(after.previewZoom, 1.1);
  assert.equal(after.sidebar.width, 310);
  assert(
    !after.documents.some((d) => d.path === root + "/boot.md"),
    "Closed CLI startup file must not reappear",
  );
  assert.equal(
    (await cmd("file.inspect", { path: root + "/note.txt", readOnly: true }))
      .text,
    "fresh disk note",
  );
  assert(after.documents.find((d) => d.path === root + "/gone.txt").loadError);
  assert.equal(after.terminal.sessions.length, 2);
  assert.equal(after.terminal.sessions[0].name, "Agent shell");
  assert.equal(after.terminal.sessions[0].location, "editor");
  await until(async () =>
    (await state()).terminal.sessions.every((t) => t.status === "running"),
  );
  assert.notEqual(
    (await state()).terminal.sessions[0].pty,
    terminal.pty,
    "Reload starts new shells",
  );
  // Settings, images and PDFs are real restored documents, not stale snapshots.
  await cmd("tab.activate", { path: root + "/review.pdf", group: 1 });
  await page.locator('.pdf-viewer[data-rendered="true"]').waitFor();
  await cmd("tab.activate", { path: root + "/owl.png", group: 1 });
  await page.locator(".image-viewer img").waitFor();
  await cmd("tab.activate", { path: root + "/plan.md", group: 1 });
  await page.locator(".markdown-preview h1").waitFor();
  await page.screenshot({ path: path.join(base, "restored-tabs.png") });
  await cmd("group.splitDown", { group });
  const ids = groupList((await state()).layout).map((g) => g.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "New group IDs cannot collide after restore",
  );
  await cmd("commands.clearRecent");
  await cmd("group.focus", { group: 1 });
  await palette("Explorer: Refresh");
  await palette("Tab: Next Tab");
  await palette("Explorer: Refresh");
  assert.deepEqual(await cmd("commands.recent", { readOnly: true }), [
    "explorer.refresh",
    "tab.next",
  ]);
  await cmd("commands.show");
  assert.match(
    await page.getByRole("option").first().innerText(),
    /Explorer: Refresh/,
  );
  await page.getByRole("textbox", { name: "Search commands" }).fill("tab");
  assert.match(
    await page.getByRole("option").first().innerText(),
    /Tab: Next Tab/,
  );
  await page.screenshot({ path: path.join(base, "recent-commands.png") });
  await page.keyboard.press("Escape");
  await cmd("explorer.refresh");
  assert.deepEqual(
    await cmd("commands.recent", { readOnly: true }),
    ["explorer.refresh", "tab.next"],
    "Internal/button/API activity does not pollute palette MRU",
  );
  // Reload chosen in the palette must persist before the renderer navigates.
  const loaded = page.waitForEvent("load");
  await palette("Window: Reload");
  await loaded;
  await page.locator('[data-ready="true"]').waitFor();
  await until(async () => !(await state()).documents.some((d) => d.loading));
  assert.equal(
    (await cmd("commands.recent", { readOnly: true }))[0],
    "window.reload",
  );
  const history = await cmd("commands.recent", { readOnly: true });
  await stop();
  await launch();
  assert.deepEqual(
    await cmd("commands.recent", { readOnly: true }),
    history,
    "History survives process restart",
  );
  // New windows load the same persisted history.
  const next = app.waitForEvent("window");
  await cmd("workspace.openLocal", { path: root });
  const other = await next;
  await other.locator('[data-ready="true"]').waitFor();
  assert.deepEqual(
    await cmd("commands.recent", { readOnly: true }, other),
    history,
  );
  await cmd("commands.clearRecent", {}, other);
  assert.deepEqual(await cmd("commands.recent", { readOnly: true }), []);
  // An intentionally empty tab group stays empty, even with a CLI startup file.
  await cmd("file.close", { path: root + "/boot.md", group: 1 });
  await reload();
  assert.deepEqual(groupList((await state()).layout)[0].tabs, []);
  if (process.env.OWLET_SSH_TARGET) {
    const { python, target } = require("./fixture.cjs");
    remoteRoot = python(
      "import pathlib,tempfile\np=pathlib.Path(tempfile.mkdtemp(prefix='owlet-reload-'))\n(p/'plan.md').write_text('# Remote plan')\n(p/'note.txt').write_text('remote before')\nprint(p)",
    );
    const local = page,
      localLayout = (await state()).layout;
    const opened = app.waitForEvent("window");
    await cmd("workspace.openSSH", { target, path: remoteRoot });
    page = await opened;
    await page.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
    await cmd("file.open", { path: remoteRoot + "/plan.md" });
    await cmd("file.open", { path: remoteRoot + "/note.txt" });
    await cmd("group.splitRight", { path: remoteRoot + "/plan.md" });
    const remoteLayout = (await state()).layout;
    python(
      `import pathlib\npathlib.Path(${JSON.stringify(remoteRoot + "/note.txt")}).write_text('remote after')`,
    );
    await cmd("connection.disconnect");
    await reload();
    assert.deepEqual((await state()).layout, remoteLayout);
    assert.equal(
      (
        await cmd("file.inspect", {
          path: remoteRoot + "/note.txt",
          readOnly: true,
        })
      ).text,
      "remote after",
    );
    await until(async () =>
      (await state()).terminal.sessions.every((t) => t.status === "running"),
    );
    assert.deepEqual(
      (await state(local)).layout,
      localLayout,
      "Reload stays scoped to its SSH window",
    );
    await page.screenshot({ path: path.join(base, "ssh-restored.png") });
  }
  console.log(
    JSON.stringify(
      {
        passed: true,
        base,
        ssh: !!process.env.OWLET_SSH_TARGET,
        checks: [
          "Reload group/tab order, modes and active selection",
          "Dirty cancellation and accepted discard reads fresh files",
          "Missing file errors, PDF/image/settings reload",
          "Terminal tabs restart without duplication",
          "Repeated reload and new group IDs",
          "Palette matching, unique MRU, reload/process/window persistence and clear",
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
    await stop();
    if (remoteRoot && /^\/tmp\/owlet-reload-[\w-]+$/.test(remoteRoot))
      require("./fixture.cjs").python(
        `import shutil\nshutil.rmtree(${JSON.stringify(remoteRoot)})`,
      );
  });
