const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const workspace = path.resolve(__dirname, "..");
const root = path.join(workspace, "artifacts/command-workspace");
fs.mkdirSync(path.join(root, "many"), { recursive: true });
for (let i = 0; i < 125; i++)
  fs.writeFileSync(
    path.join(root, "many", `${String(i).padStart(3, "0")}.txt`),
    "fixture",
  );
fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n\nalpha alpha\n");
fs.writeFileSync(path.join(root, "other.txt"), "other\n");
fs.copyFileSync(
  path.join(workspace, "assets/icon.png"),
  path.join(root, "owl.png"),
);
const normalize = (p) => p.replaceAll("\\", "/");
(async () => {
  const app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [workspace, "--local", root] }),
    env: {
      ...process.env,
      OWLET_USER_DATA: path.join(workspace, "artifacts/commands-profile"),
    },
  });
  const results = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.locator('[data-ready="true"]').waitFor();
    const command = (id, args = {}, target = page) =>
      target.evaluate(
        ({ id, args }) => window.owletCommands.execute(id, args),
        { id, args },
      );
    const state = () => command("workspace.state", { readOnly: true });
    const remoteButton = page
      .locator("footer")
      .getByRole("button", { name: "Connect to Remote", exact: true });
    await remoteButton.click();
    await page
      .getByRole("dialog", { name: "Connect to Remote", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    for (const query of ["remote", "Open Remote", "SSH"]) {
      await command("commands.show");
      await page.getByRole("textbox", { name: "Search commands" }).fill(query);
      const first = page.getByRole("option").first();
      assert.match(await first.innerText(), /Connect to Remote/);
      await first.click();
      await page
        .getByRole("dialog", { name: "Connect to Remote", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    results.push(
      "Bottom-left remote button and remote/Open Remote/SSH palette aliases open the same dialog",
    );
    await command("explorer.toggleFolder", {
      path: normalize(path.join(root, "many")),
    });
    await page.getByRole("button", { name: "000.txt", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "124.txt", exact: true }).count(),
      0,
    );
    await command("explorer.loadMore", {
      path: normalize(path.join(root, "many")),
    });
    await page.getByRole("button", { name: "124.txt", exact: true }).waitFor();
    await command("explorer.collapseFolder", {
      path: normalize(path.join(root, "many")),
    });
    await page
      .getByRole("button", { name: "000.txt", exact: true })
      .waitFor({ state: "hidden" });
    await command("explorer.setWidth", { width: 210 });
    assert.equal((await state()).sidebar.width, 210);
    results.push(
      "Explorer commands expand, paginate, collapse, and set exact width",
    );
    const plan = normalize(path.join(root, "plan.md"));
    await command("file.open", { path: plan });
    await command("markdown.resize", { ratio: 0.35 });
    await page.locator(".cm-content").waitFor();
    assert.equal((await state()).previewRatios[`1:${plan}`], 0.35);
    await command("editor.setText", { text: "# Plan\n\nalpha alpha\nchanged" });
    assert.match(
      (await command("file.inspect", { readOnly: true })).text,
      /changed/,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "plan.md"), "utf8"),
      "# Plan\n\nalpha alpha\n",
    );
    await command("editor.replaceAll", { search: "alpha", replace: "beta" });
    await page.waitForFunction(() =>
      document.querySelector(".cm-content")?.textContent.includes("beta beta"),
    );
    await command("file.revert");
    const question = (await state()).confirmation;
    await assert.rejects(
      command("confirmation.accept", { token: "stale" }),
      /Confirmation changed/,
    );
    await command("confirmation.accept", { token: question.token });
    await page.waitForFunction(() => !document.querySelector(".dirty-dot"));
    results.push(
      "Source/preview split, unsaved buffer editing, inspect, replace-all, and token-checked confirmation",
    );
    await command("group.splitRight");
    const second = (await state()).activeGroup;
    await command("file.open", {
      path: normalize(path.join(root, "other.txt")),
      group: second,
    });
    await command("tab.activate", { path: plan, group: 1 });
    assert.equal((await state()).activeGroup, 1);
    await command("group.focus", { group: second });
    assert.equal((await state()).activeGroup, second);
    await assert.rejects(
      command("group.focus", { group: 99999 }),
      /Unknown group/,
    );
    await command("terminal.setHeight", { height: 180 });
    assert.equal((await state()).terminal.height, 180);
    await page.locator(".xterm-helper-textarea").waitFor();
    await page.evaluate(() => {
      window.__commandTerminalText = "";
      window.lwr.onTerminal((event) => {
        if (event.data) window.__commandTerminalText += atob(event.data);
      });
    });
    await command("terminal.sendText", {
      text: "Write-Output ('OWLET_' + 'COMMAND_OK')\r",
    });
    await page.waitForFunction(() =>
      window.__commandTerminalText.includes("OWLET_COMMAND_OK"),
    );
    await command("file.open", { path: normalize(path.join(root, "owl.png")) });
    await page.locator(".image-viewer img").waitFor();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByText("125%", { exact: true }).waitFor();
    await command("image.fit");
    await page
      .locator(".image-controls span")
      .filter({ hasText: "Fit" })
      .waitFor();
    results.push(
      "Targeted groups/tabs and image UI/API actions share commands; exact terminal height",
    );
    const commands = await page.evaluate(() => window.owletCommands.list());
    assert.equal(new Set(commands.map((c) => c.id)).size, commands.length);
    for (const id of [
      "workspace.openSSH",
      "explorer.loadMore",
      "editor.setText",
      "file.inspect",
      "markdown.resize",
      "tab.activate",
      "group.focus",
      "confirmation.accept",
      "terminal.sendText",
    ])
      assert.ok(commands.some((c) => c.id === id));
    if (process.env.OWLET_SSH_TARGET) {
      const fixture = require("./fixture.cjs").createFixture();
      await remoteButton.click();
      await page
        .getByRole("textbox", { name: "SSH host", exact: true })
        .fill(process.env.OWLET_SSH_TARGET);
      await page
        .getByRole("textbox", { name: "Remote folder", exact: true })
        .fill(fixture.root);
      const opened = app.waitForEvent("window");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      const remote = await opened;
      await remote.locator('[data-ready="true"]').waitFor();
      assert.equal(
        (await remote.evaluate(() => window.lwr.bootstrap())).connection.kind,
        "ssh",
      );
      await remote
        .locator("footer")
        .getByRole("button", { name: "Connect to Remote", exact: true })
        .click();
      await remote
        .getByRole("dialog", { name: "Connect to Remote", exact: true })
        .waitFor();
      assert.equal(
        await remote
          .getByRole("textbox", { name: "SSH host", exact: true })
          .inputValue(),
        process.env.OWLET_SSH_TARGET,
      );
      await remote.getByRole("button", { name: "Cancel", exact: true }).click();
      await remote.close();
      results.push(
        "Connection form opens a real SSH workspace; remote control remains available in the remote window",
      );
    }
    await command("tab.activate", { path: plan, group: 1 });
    await page.screenshot({
      path: path.join(workspace, "artifacts/commands-proof.png"),
    });
    fs.writeFileSync(
      path.join(workspace, "artifacts/command-audit.json"),
      JSON.stringify(
        {
          packaged: !!process.env.LWR_PACKAGED,
          commandCount: commands.length,
          commands,
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ commandCount: commands.length, results }, null, 2),
    );
  } finally {
    // This process owns only generated fixtures. A failed dirty-buffer assertion
    // must not leave a native close-confirmation dialog blocking test cleanup.
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
