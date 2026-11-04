const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = fs.mkdtempSync(path.resolve("artifacts/close-others-"));
const root = base.replaceAll("\\", "/");
for (const name of [
  "keep.txt",
  "clean.txt",
  "dirty.txt",
  "second.txt",
  "late.txt",
])
  fs.writeFileSync(path.join(base, name), name);
const allGroups = (n) =>
  n.kind === "group"
    ? [n.group]
    : [...allGroups(n.first), ...allGroups(n.second)];
let app;
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", base],
        }
      : { args: [path.resolve("."), "--local", base] }),
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd("workspace.state", { readOnly: true });
  const tabs = async (id) =>
    allGroups((await state()).layout).find((g) => g.id === id).tabs;
  const open = (name, group = 1) =>
    cmd("file.open", { path: root + "/" + name, group });
  const accept = async () =>
    cmd("confirmation.accept", { token: (await state()).confirmation.token });
  await open("keep.txt");
  await open("clean.txt");
  await cmd("group.splitRight", { group: 1, path: root + "/clean.txt" });
  const otherGroup = (await state()).activeGroup;
  // Right-click a background tab: preserve that tab, not the active sibling.
  await page
    .locator('[data-group="1"]')
    .getByRole("tab", { name: /^keep.txt/ })
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Tab actions" });
  await menu
    .getByRole("menuitem", { name: "Close Others", exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(base, "close-others-menu.png") });
  await menu
    .getByRole("menuitem", { name: "Close Others", exact: true })
    .click();
  assert.deepEqual(await tabs(1), [root + "/keep.txt"]);
  assert.deepEqual(await tabs(otherGroup), [root + "/clean.txt"]);
  // Same behavior through the palette, with the active tab as default.
  await open("clean.txt");
  await cmd("tab.activate", { path: root + "/keep.txt", group: 1 });
  await cmd("commands.show");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("close others");
  await page.keyboard.press("Enter");
  assert.deepEqual(await tabs(1), [root + "/keep.txt"]);
  // Dirty buffer shared with another group must not be discarded or prompt.
  await open("clean.txt");
  await cmd("editor.setText", {
    path: root + "/clean.txt",
    text: "shared edits",
  });
  await cmd("tab.closeOthers", { path: root + "/keep.txt", group: 1 });
  assert.equal((await state()).confirmation, null);
  assert.equal(
    (await cmd("file.inspect", { path: root + "/clean.txt", readOnly: true }))
      .text,
    "shared edits",
  );
  // Cancel stops a batch; each subsequent dirty tab gets its own confirmation.
  await open("dirty.txt");
  await cmd("editor.setText", {
    path: root + "/dirty.txt",
    text: "unsaved first",
  });
  await open("second.txt");
  await cmd("editor.setText", {
    path: root + "/second.txt",
    text: "unsaved second",
  });
  await cmd("tab.closeOthers", { path: root + "/keep.txt", group: 1 });
  assert.match((await state()).confirmation.title, /dirty.txt/);
  await cmd("confirmation.cancel");
  assert.equal((await tabs(1)).length, 3);
  await cmd("tab.closeOthers", { path: root + "/keep.txt", group: 1 });
  await open("late.txt");
  await accept();
  assert.match((await state()).confirmation.title, /second.txt/);
  await accept();
  assert.deepEqual(await tabs(1), [root + "/keep.txt", root + "/late.txt"]);
  assert.equal(
    fs.readFileSync(path.join(base, "dirty.txt"), "utf8"),
    "dirty.txt",
  );
  assert.equal(
    fs.readFileSync(path.join(base, "second.txt"), "utf8"),
    "second.txt",
  );
  // Terminal tabs retain their shell-close confirmation and resume the batch.
  const terminal = (await state()).terminal.sessions[0].id;
  await cmd("group.focus", { group: 1 });
  await cmd("terminal.moveToEditor", { id: terminal, group: 1 });
  await cmd("tab.closeOthers", { path: root + "/keep.txt", group: 1 });
  assert.match((await state()).confirmation.title, /Kill/);
  await cmd("confirmation.cancel");
  assert((await tabs(1)).includes(terminal));
  await cmd("tab.closeOthers", { path: root + "/keep.txt", group: 1 });
  await accept();
  assert.deepEqual(await tabs(1), [root + "/keep.txt"]);
  assert(!(await state()).terminal.sessions.some((t) => t.id === terminal));
  // Invalid targets fail without closing anything.
  await open("late.txt");
  await assert.rejects(
    cmd("tab.closeOthers", { group: 1, path: root + "/absent.txt" }),
    /Choose a tab/,
  );
  assert.deepEqual(await tabs(1), [root + "/keep.txt", root + "/late.txt"]);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        base,
        checks: [
          "Clicked-tab/group scope",
          "Palette defaults and API equivalence",
          "Shared dirty buffer preserved",
          "Cancel and sequential confirmations",
          "New tabs survive pending confirmation",
          "Terminal confirmation",
          "Invalid target validation",
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
