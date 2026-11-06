const { _electron } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/tab-tiling-")),
  root = path.join(base, "workspace").replaceAll("\\", "/");
fs.mkdirSync(root);
for (const name of ["a.md", "b.txt", "c.txt"])
  fs.writeFileSync(root + "/" + name, "# " + name);
let app, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 20000) throw Error("Timed out");
    await sleep(60);
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
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = async () => {
    const value = await cmd("workspace.state", { readOnly: true });
    const groups = (node) =>
      node.kind === "group"
        ? [node.group]
        : [...groups(node.first), ...groups(node.second)];
    return { ...value, groups: groups(value.layout) };
  };
  await page.locator('[data-ready="true"]').waitFor();
  for (const name of ["a.md", "b.txt", "c.txt"])
    await cmd("file.open", { path: root + "/" + name });
  await cmd("editor.setText", { text: "dirty c" });
  const cdp = await page.context().newCDPSession(page);
  async function drop(payload, group, edge, screenshot) {
    const target = page.locator(`[data-group="${group}"]`),
      box = await target.boundingBox();
    const x =
      edge === "left"
        ? box.x + 10
        : edge === "right"
          ? box.x + box.width - 10
          : box.x + box.width / 2;
    const y =
      edge === "top"
        ? box.y + 45
        : edge === "bottom"
          ? box.y + box.height - 10
          : box.y + box.height / 2;
    const data = {
      items: [
        {
          mimeType: payload.terminal
            ? "application/owlet-terminal"
            : "application/lwr-tab",
          data: payload.terminal || JSON.stringify(payload),
        },
      ],
      dragOperationsMask: 16,
    };
    for (const type of ["dragEnter", "dragOver"])
      await cdp.send("Input.dispatchDragEvent", { type, x, y, data });
    await page.locator(`.tab-drop-preview[data-edge="${edge}"]`).waitFor();
    if (screenshot)
      await page.screenshot({ path: path.join(base, "drop-preview.png") });
    await cdp.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
    await page.locator(".tab-drop-preview").waitFor({ state: "detached" });
  }
  await drop({ path: root + "/c.txt", source: 1 }, 1, "right", true);
  await until(async () => (await state()).groups.length === 2);
  let s = await state(),
    right = s.activeGroup;
  assert.ok(
    s.groups.find((group) => group.id === right).tabs.includes(root + "/c.txt"),
  );
  assert.equal(
    (await cmd("file.inspect", { path: root + "/c.txt", readOnly: true })).text,
    "dirty c",
  );
  await drop({ path: root + "/b.txt", source: 1 }, right, "bottom");
  await until(async () => (await state()).groups.length === 3);
  const bottom = (await state()).activeGroup;
  const below = await page.locator(`[data-group="${bottom}"]`).boundingBox(),
    above = await page.locator(`[data-group="${right}"]`).boundingBox();
  assert.ok(below.y > above.y + 20);
  await cmd("group.tileTab", {
    path: root + "/a.md",
    source: 1,
    destination: right,
    edge: "left",
  });
  s = await state();
  assert.equal(s.groups.length, 3, "empty former source collapses");
  const left = s.activeGroup;
  assert.ok(
    (await page.locator(`[data-group="${left}"]`).boundingBox()).x <
      (await page.locator(`[data-group="${right}"]`).boundingBox()).x,
  );
  await cmd("terminal.new");
  await cmd("terminal.rename", { name: "Tiling shell" });
  await until(async () =>
    (await state()).terminal.sessions.some(
      (item) => item.name === "Tiling shell" && item.status === "running",
    ),
  );
  const shell = (await state()).terminal.sessions.find(
    (item) => item.name === "Tiling shell",
  );
  await page.evaluate(() => {
    window.__terminalNodes = [...document.querySelectorAll(".terminal-host")];
  });
  await drop({ terminal: shell.id }, right, "top");
  await until(
    async () =>
      (await state()).terminal.sessions.find((item) => item.id === shell.id)
        .location === "editor",
  );
  const after = (await state()).terminal.sessions.find(
    (item) => item.id === shell.id,
  );
  assert.equal(after.pty, shell.pty);
  assert.equal(after.restart, shell.restart);
  const terminalGroup = (await state()).activeGroup;
  await drop({ path: shell.id, source: terminalGroup }, bottom, "center");
  await until(
    async () =>
      !(await state()).groups.some((group) => group.id === terminalGroup),
  );
  assert.equal(
    (await state()).terminal.sessions.find((item) => item.id === shell.id).pty,
    shell.pty,
  );
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll(".terminal-host")].every((node) =>
        window.__terminalNodes.includes(node),
      ),
    ),
    "moving terminals preserves xterm nodes",
  );
  await cmd("terminal.sendText", { id: shell.id, text: "echo TILING_ALIVE\r" });
  await page
    .locator(`[data-group="${bottom}"] .xterm-rows`)
    .getByText("TILING_ALIVE", { exact: true })
    .last()
    .waitFor();
  const tab = page.locator(`[data-group="${right}"] .tab`).first(),
    tabBox = await tab.boundingBox();
  const paneBox = await page.locator(`[data-group="${right}"]`).boundingBox();
  const countBefore = (await state()).groups.length;
  await page.mouse.move(tabBox.x + 25, tabBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(tabBox.x + 40, tabBox.y + 50, { steps: 5 });
  await page.mouse.move(
    paneBox.x + paneBox.width - 10,
    paneBox.y + paneBox.height / 2,
    { steps: 10 },
  );
  await page.locator('.tab-drop-preview[data-edge="right"]').waitFor();
  await page.mouse.up();
  await until(async () => (await state()).groups.length === countBefore + 1);
  assert.equal(
    (await cmd("file.inspect", { path: root + "/c.txt", readOnly: true })).text,
    "dirty c",
  );
  await assert.rejects(
    cmd("group.tileTab", {
      path: root + "/c.txt",
      destination: right,
      edge: "bad",
    }),
    /valid target/,
  );
  assert.equal(
    fs.readFileSync(root + "/c.txt", "utf8"),
    "# c.txt",
    "tiling never saves dirty buffers",
  );
  await page.screenshot({ path: path.join(base, "tiled-workspace.png") });
  console.log(
    JSON.stringify({
      passed: true,
      base,
      checks: [
        "drop previews",
        "right bottom top and left tiling",
        "source collapse",
        "center move",
        "dirty buffer retained",
        "terminal PTY retained",
        "UI and command paths",
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
  });
