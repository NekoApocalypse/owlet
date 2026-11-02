const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(
  path.join(workspace, "artifacts/terminal-workspaces-"),
);
const note = path.join(fixture, "review.md").replaceAll("\\", "/");
fs.writeFileSync(
  note,
  "# Terminal review\n\nalpha alpha\n\n```mermaid\nflowchart LR\n" +
    Array.from(
      { length: 24 },
      (_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`,
    ).join("\n") +
    "\n```\n\n```mermaid\nsequenceDiagram\nAgent->>Human: Review this work\nHuman-->>Agent: Continue\n```\n",
);
let app, activePage;
const results = [];
const command = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
const state = (page) => command(page, "workspace.state", { readOnly: true });
async function waitState(page, predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await state(page);
    if (predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  throw new Error("Workspace state did not become ready");
}
async function running(page, count) {
  return (
    await waitState(
      page,
      (value) =>
        value.terminal.sessions.length === count &&
        value.terminal.sessions.every(
          (item) => item.status === "running" && item.pty,
        ),
    )
  ).terminal.sessions;
}
async function capture(page) {
  await page.evaluate(() => {
    window.__terminalOutput = {};
    window.lwr.onTerminal((event) => {
      if (event.data)
        window.__terminalOutput[event.terminal] =
          (window.__terminalOutput[event.terminal] || "") + atob(event.data);
    });
  });
}
async function checkTerminalBackdrop(page, id) {
  const colors = await page
    .locator(`[data-terminal-id="${id}"]`)
    .evaluate((el) => ({
      viewport: getComputedStyle(el.querySelector(".xterm-viewport"))
        .backgroundColor,
      rows: getComputedStyle(el.querySelector(".xterm-scrollable-element"))
        .backgroundColor,
    }));
  assert.equal(
    colors.viewport,
    colors.rows,
    "The partial-row space below the terminal must match its rendered background",
  );
}
async function output(page, pty, text) {
  try {
    await page.waitForFunction(
      ({ pty, text }) => (window.__terminalOutput[pty] || "").includes(text),
      { pty, text },
    );
  } catch (error) {
    console.error(
      "Terminal output diagnostic",
      JSON.stringify(await page.evaluate(() => window.__terminalOutput)),
    );
    console.error(
      "Terminal state",
      JSON.stringify((await state(page)).terminal),
    );
    throw error;
  }
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", fixture],
        }
      : { args: [workspace, "--local", fixture] }),
    env: { ...process.env, OWLET_USER_DATA: path.join(fixture, "profile") },
  });
  const page = await app.firstWindow();
  activePage = page;
  page.setDefaultTimeout(20000);
  await page.locator('[data-ready="true"]').waitFor();
  const [first] = await running(page, 1);
  await checkTerminalBackdrop(page, first.id);
  await capture(page);
  await command(page, "terminal.sendText", {
    id: first.id,
    text: "$env:OWLET_PROBE='ONE'; Write-Output ('READY_'+'ONE')\r",
  });
  await output(page, first.pty, "READY_ONE");
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  const second = (await running(page, 2)).find((item) => item.id !== first.id);
  await page.getByRole("listbox", { name: "Terminals", exact: true }).waitFor();
  const selected = await page.evaluate(async (id) => {
    await window.owletCommands.execute("terminal.select", { id });
    await window.owletCommands.execute("terminal.rename", {
      name: "Agent two",
    });
    return window.owletCommands.execute("workspace.state", { readOnly: true });
  }, second.id);
  assert.equal(
    selected.terminal.sessions.find((item) => item.id === second.id).name,
    "Agent two",
  );
  await command(page, "terminal.rename", { id: second.id, name: "Agent two" });
  await command(page, "terminal.sendText", {
    id: second.id,
    text: "$env:OWLET_PROBE='TWO'; Write-Output ('READY_'+'TWO')\r",
  });
  await output(page, second.pty, "READY_TWO");
  await page.evaluate((id) => {
    window.__terminalSurface = document.querySelector(
      `[data-terminal-id="${id}"]`,
    );
  }, first.id);
  await command(page, "file.open", { path: note });
  await command(page, "group.splitRight");
  const destination = (await state(page)).activeGroup;
  await command(page, "terminal.moveToEditor", {
    id: first.id,
    group: destination,
  });
  await page.locator(`[data-terminal-tab="${first.id}"]`).waitFor();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".editor-terminal")
        ?.contains(document.querySelector(`[data-terminal-id="${id}"]`)),
    first.id,
  );
  assert.equal(
    await page.evaluate(
      (id) =>
        window.__terminalSurface ===
        document.querySelector(`[data-terminal-id="${id}"]`),
      first.id,
    ),
    true,
  );
  assert.equal(
    (await state(page)).terminal.sessions.find((item) => item.id === first.id)
      .pty,
    first.pty,
  );
  await command(page, "terminal.sendText", {
    id: first.id,
    text: "Write-Output ('VALUE_' + $env:OWLET_PROBE)\r",
  });
  await output(page, first.pty, "VALUE_ONE");
  await checkTerminalBackdrop(page, first.id);
  assert.equal(
    await page.evaluate(
      (pty) => (window.__terminalOutput[pty] || "").includes("VALUE_ONE"),
      second.pty,
    ),
    false,
  );
  await command(page, "tab.activate", { path: note, group: destination });
  await command(page, "terminal.sendText", {
    id: first.id,
    text: "Write-Output ('HIDDEN_'+'ALIVE')\r",
  });
  await output(page, first.pty, "HIDDEN_ALIVE");
  await command(page, "terminal.select", { id: first.id });
  await command(page, "group.splitDown");
  assert.equal(
    await page.locator(`[data-terminal-tab="${first.id}"]`).count(),
    1,
  );
  assert.equal(
    (await state(page)).terminal.sessions.find((item) => item.id === first.id)
      .pty,
    first.pty,
  );
  await command(page, "terminal.moveToPanel", { id: first.id });
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".terminal-content")
        ?.contains(document.querySelector(`[data-terminal-id="${id}"]`)),
    first.id,
  );
  await command(page, "terminal.toggle");
  await command(page, "terminal.toggle");
  assert.equal(
    (await state(page)).terminal.sessions.find((item) => item.id === first.id)
      .pty,
    first.pty,
  );
  await page.screenshot({
    path: path.join(workspace, "artifacts/multiple-terminals-proof.png"),
  });
  results.push(
    "Independent shells, right-side list, rename, hidden output, editor tabs, split movement and panel return preserve PTY and xterm identity",
  );
  await command(page, "terminal.close", { id: second.id });
  await page.getByRole("dialog", { name: "Kill Agent two?" }).waitFor();
  await command(page, "confirmation.cancel");
  assert.equal((await state(page)).terminal.sessions.length, 2);
  await command(page, "terminal.close", { id: second.id });
  await command(page, "confirmation.accept", {
    token: (await state(page)).confirmation.token,
  });
  await running(page, 1);
  await command(page, "terminal.sendText", {
    id: first.id,
    text: "Write-Output ('SURVIVOR_'+'OK')\r",
  });
  await output(page, first.pty, "SURVIVOR_OK");
  await assert.rejects(
    command(page, "terminal.sendText", { id: second.id, text: "ignored" }),
    /existing terminal/,
  );
  results.push(
    "Killing a running terminal requires confirmation and leaves the other shell running",
  );
  await command(page, "file.open", { path: note });
  await command(page, "markdown.preview");
  const group = (await state(page)).activeGroup;
  const preview = page.locator(`[data-group="${group}"]`);
  await preview
    .getByRole("button", { name: "Expand Mermaid diagram 1", exact: true })
    .waitFor();
  const before = (await command(page, "file.inspect", { readOnly: true })).text;
  await preview
    .getByRole("button", { name: "Expand Mermaid diagram 1", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Expanded Mermaid diagram" })
    .waitFor();
  await waitState(page, (value) => value.diagram && value.diagram.scale < 1);
  const fitted = (await state(page)).diagram;
  await page
    .getByRole("button", { name: "Zoom diagram in", exact: true })
    .click();
  assert.ok((await state(page)).diagram.scale > fitted.scale);
  const canvas = page.locator(".diagram-canvas"),
    box = await canvas.boundingBox();
  const old = (await state(page)).diagram;
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 250, { steps: 5 });
  await page.mouse.up();
  assert.ok((await state(page)).diagram.x > old.x + 60);
  await page.mouse.wheel(0, -400);
  await waitState(page, (value) => value.diagram.scale > old.scale);
  await command(page, "diagram.actualSize");
  assert.equal((await state(page)).diagram.scale, 1);
  await command(page, "diagram.zoom", { scale: 100 });
  assert.equal((await state(page)).diagram.scale, 16);
  await assert.rejects(
    command(page, "diagram.pan", { dx: "invalid" }),
    /numeric/,
  );
  await command(page, "diagram.fit");
  await page.screenshot({
    path: path.join(workspace, "artifacts/diagram-viewer-proof.png"),
  });
  await page.keyboard.press("Control+Shift+P");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Diagram: Close Expanded View");
  await page.getByRole("option").first().click();
  await page
    .getByRole("dialog", { name: "Expanded Mermaid diagram" })
    .waitFor({ state: "hidden" });
  await preview
    .getByRole("button", { name: "Expand Mermaid diagram 2", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Expanded Mermaid diagram" })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    (await command(page, "file.inspect", { readOnly: true })).text,
    before,
  );
  results.push(
    "Large Mermaid modal fits, zooms around pointer, pans, resets, supports multiple diagrams and palette/keyboard dismissal without editing Markdown",
  );
  await command(page, "editor.find", { search: "alpha", replace: "beta" });
  const search = page.locator(`[data-group="${group}"] .cm-search`);
  await search.waitFor();
  const styles = await search
    .locator('button[name="replace"]')
    .evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      image: getComputedStyle(button).backgroundImage,
    }));
  assert.equal(styles.image, "none");
  assert.equal(styles.background, "rgb(0, 52, 110)");
  await search.locator('button[name="replaceAll"]').click();
  assert.ok(
    (await command(page, "file.inspect", { readOnly: true })).text.includes(
      "beta beta",
    ),
  );
  await page.screenshot({
    path: path.join(workspace, "artifacts/find-replace-proof.png"),
  });
  results.push(
    "Find/Replace uses Owlet colors and controls while native replacement remains functional",
  );
  if (process.env.OWLET_SSH_TARGET) {
    const remoteFixture = require("./fixture.cjs").createFixture();
    const opened = app.waitForEvent("window");
    await command(page, "workspace.openSSH", {
      target: process.env.OWLET_SSH_TARGET,
      path: remoteFixture.root,
    });
    const remote = await opened;
    activePage = remote;
    await remote.locator('[data-ready="true"]').waitFor();
    const [a] = await running(remote, 1);
    await capture(remote);
    await command(remote, "terminal.new");
    const b = (await running(remote, 2)).find((item) => item.id !== a.id);
    await command(remote, "terminal.sendText", {
      id: a.id,
      text: "OWLET_PROBE=remote_one; printf 'READY_%s\\n' remote_one\r",
    });
    await output(remote, a.pty, "READY_remote_one");
    await command(remote, "terminal.moveToEditor", { id: a.id });
    await command(remote, "terminal.sendText", {
      id: a.id,
      text: "printf 'VALUE_%s\\n' \"$OWLET_PROBE\"\r",
    });
    await output(remote, a.pty, "VALUE_remote_one");
    assert.equal(
      (await state(remote)).terminal.sessions.find((item) => item.id === a.id)
        .pty,
      a.pty,
    );
    await command(remote, "terminal.sendText", {
      id: b.id,
      text: "printf 'OTHER_%s\\n' running\r",
    });
    await output(remote, b.pty, "OTHER_running");
    await command(remote, "connection.disconnect");
    await waitState(remote, (value) =>
      value.terminal.sessions.every((item) => item.status === "disconnected"),
    );
    await command(remote, "connection.reconnect");
    await remote.waitForTimeout(500);
    assert.ok(
      (await state(remote)).terminal.sessions.every(
        (item) => item.status === "disconnected",
      ),
    );
    await command(remote, "terminal.start", { id: a.id });
    await waitState(
      remote,
      (value) =>
        value.terminal.sessions.find((item) => item.id === a.id).status ===
        "running",
    );
    assert.equal(
      (await state(remote)).terminal.sessions.find((item) => item.id === b.id)
        .status,
      "disconnected",
    );
    results.push(
      "Real SSH concurrent shells survive editor movement; reconnect restarts only the explicitly selected terminal",
    );
  }
  fs.writeFileSync(
    path.join(workspace, "artifacts/terminal-workspaces-results.json"),
    JSON.stringify({ packaged: !!process.env.LWR_PACKAGED, results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})()
  .catch(async (e) => {
    console.error(e);
    if (activePage) {
      console.error(
        "Final state",
        JSON.stringify(await state(activePage).catch(() => null)),
      );
      console.error(
        "Final output",
        JSON.stringify(
          await activePage
            .evaluate(() => window.__terminalOutput)
            .catch(() => null),
        ),
      );
      await activePage
        .screenshot({
          path: path.join(
            workspace,
            "artifacts/terminal-workspaces-failure.png",
          ),
        })
        .catch(() => {});
    }
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
