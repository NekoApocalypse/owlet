const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const root = path.join(workspace, "artifacts", "Local workspace 中文");
fs.mkdirSync(path.join(root, "nested space"), { recursive: true });
fs.writeFileSync(
  path.join(root, "REVIEW.md"),
  fs
    .readFileSync(
      path.join(workspace, "examples/agent-review/REVIEW.md"),
      "utf8",
    )
    .replace("../../assets/icon.png", "owl.png"),
);
fs.copyFileSync(
  path.join(workspace, "examples/agent-review/review.py"),
  path.join(root, "review.py"),
);
fs.writeFileSync(path.join(root, "notes.md"), "# Original\r\n");
fs.copyFileSync(
  path.join(workspace, "assets/icon.png"),
  path.join(root, "owl.png"),
);

const normalize = (value) => value.replaceAll("\\", "/");
let app;
const results = [];
(async () => {
  const started = performance.now();
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [workspace, "--local", root] }),
    env: {
      ...process.env,
      OWLET_SSH_TARGET: "unreachable.invalid",
      LWR_SSH_TARGET: "unreachable.invalid",
      OWLET_ROOT: "",
      LWR_ROOT: "",
      OWLET_USER_DATA: path.join(workspace, "artifacts/local-ui-profile"),
      LWR_USER_DATA: path.join(workspace, "artifacts/local-ui-profile"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.locator('[data-ready="true"]').waitFor();
  const command = (id, args = {}, target = page) =>
    target.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  assert.equal(
    (await page.evaluate(() => window.lwr.bootstrap())).connection.kind,
    "local",
  );
  await page
    .getByRole("button", { name: "Local workspace", exact: true })
    .waitFor();
  results.push({
    name: "local startup independent of unreachable SSH target",
    readyMs: Math.round(performance.now() - started),
  });
  await app.context().setOffline(true);
  await command("file.open", { path: normalize(path.join(root, "REVIEW.md")) });
  await page.locator(".diagram svg").waitFor();
  assert.equal(await page.locator(".katex").count(), 3);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".markdown-preview img")].some(
      (image) => image.naturalWidth === 256,
    ),
  );
  results.push({ name: "offline Markdown math, Mermaid and local images" });
  for (let i = 0; i < 3; i++) await command("group.splitRight");
  const countGroups = (node) =>
    node.kind === "group"
      ? 1
      : countGroups(node.first) + countGroups(node.second);
  assert.equal(
    countGroups((await command("workspace.state", { readOnly: true })).layout),
    4,
  );
  results.push({ name: "local splittable tab groups" });
  const notes = normalize(path.join(root, "notes.md"));
  await command("file.open", { path: notes });
  await command("markdown.source");
  if ((await command("workspace.state", { readOnly: true })).vimMode)
    await command("editor.vim");
  const editor = page.locator(".editor-host:visible .cm-content").last();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# My edits\n");
  assert.equal(fs.readFileSync(notes, "utf8"), "# Original\r\n");
  fs.writeFileSync(notes, "# Agent changes\r\n");
  await command("file.save");
  await page
    .getByRole("dialog", { name: "Compare conflicting changes" })
    .waitFor();
  assert.equal(fs.readFileSync(notes, "utf8"), "# Agent changes\r\n");
  const state = await command("workspace.state");
  const conflict = await command("conflict.useRemote");
  await command("conflict.useRemote", {
    confirmed: true,
    revision: conflict.revision,
  });
  await page.waitForFunction(() => !document.querySelector(".compare-modal"));
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# Saved locally\n");
  await command("file.save");
  assert.equal(fs.readFileSync(notes, "utf8"), "# Saved locally\r\n");
  fs.writeFileSync(notes, "# Updated by agent\r\n");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cm-content")].some((element) =>
      element.textContent.includes("Updated by agent"),
    ),
  );
  results.push({
    name: "dirty buffers, conflict resolution, explicit save and external refresh",
  });
  await command("project.color.set", { color: "#376b62" });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, ".owlet/settings.json")))[
      "peacock.color"
    ],
    "#376b62",
  );
  results.push({ name: "local project color persists" });
  const terminal = await page.evaluate(async (root) => {
    window.__terminalText = "";
    window.__terminalOff = window.lwr.onTerminal((event) => {
      if (event.data) window.__terminalText += atob(event.data);
    });
    return window.lwr.startTerminal({ path: root, cols: 100, rows: 24 });
  }, normalize(root));
  await page.waitForFunction(() => window.__terminalText.includes("PS "));
  const input = async (text) =>
    page.evaluate(
      ({ terminal, data }) =>
        window.lwr.terminal("terminal-input", { terminal, data }),
      { terminal, data: Buffer.from(text).toString("base64") },
    );
  await input("Write-Output 'OWLET_LOCAL_TERMINAL_OK'\r");
  await page.waitForFunction(() =>
    window.__terminalText.includes("OWLET_LOCAL_TERMINAL_OK"),
  );
  const before = app.windows().length;
  await input(
    "Set-Location -LiteralPath '" +
      path.join(root, "nested space").replaceAll("'", "''") +
      "'; owlet .\r",
  );
  await page.waitForFunction(() =>
    window.__terminalText.includes("nested space"),
  );
  for (let i = 0; i < 100 && app.windows().length === before; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    app.windows().length,
    before + 1,
    "owlet . opens a local window",
  );
  const child = app.windows().at(-1);
  await child.locator('[data-ready="true"]').waitFor();
  assert.equal(
    (await child.evaluate(() => window.lwr.bootstrap())).root,
    normalize(path.join(root, "nested space")),
  );
  await child.close();
  await page.evaluate(
    (terminal) => window.lwr.terminal("terminal-close", { terminal }),
    terminal,
  );
  results.push({
    name: "native local PowerShell and owlet . from a spaced directory",
  });
  const commands = await page.evaluate(() => window.owletCommands.list());
  assert.ok(commands.some((command) => command.id === "workspace.openLocal"));
  assert.ok(commands.some((command) => command.id === "workspace.openSSH"));
  results.push({ name: "workspace commands available in palette and API" });
  if (process.env.OWLET_TEST_SSH_TARGET) {
    await app.context().setOffline(false);
    const fixture = require("../artifacts/fixture.json");
    const count = app.windows().length;
    await command("workspace.openSSH", {
      target: process.env.OWLET_TEST_SSH_TARGET,
      path: fixture.root,
    });
    for (let i = 0; i < 100 && app.windows().length === count; i++)
      await new Promise((r) => setTimeout(r, 100));
    const remote = app.windows().at(-1);
    await remote.locator('[data-ready="true"]').waitFor();
    assert.equal(
      (await remote.evaluate(() => window.lwr.bootstrap())).connection.kind,
      "ssh",
    );
    await command("file.open", { path: fixture.root + "/README.md" }, remote);
    await remote.locator(".diagram svg").waitFor();
    await command("connection.disconnect", {}, remote);
    await remote.waitForFunction(
      async () =>
        (await window.lwr.bootstrap()).connection.status === "disconnected",
    );
    assert.equal(
      (await page.evaluate(() => window.lwr.bootstrap())).connection.status,
      "connected",
    );
    assert.equal(
      (
        await page.evaluate(
          (path) => window.lwr.remote("read", { path }),
          notes,
        )
      ).text,
      "# Updated by agent\r\n",
    );
    await remote.close();
    results.push({
      name: "mixed local and real SSH windows; SSH disconnect leaves local files and shell independent",
    });
  }
  fs.writeFileSync(
    path.join(workspace, "artifacts/local-ui-results.json"),
    JSON.stringify({ packaged: !!process.env.LWR_PACKAGED, results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
  });
