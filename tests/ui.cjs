const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Connection } = require("../electron/connection.cjs");
const { createFixture } = require("./fixture.cjs");
const fixture = fs.existsSync(path.join(__dirname, "../artifacts/fixture.json"))
  ? require("../artifacts/fixture.json")
  : createFixture();
const workspace = path.join(__dirname, "..");
const results = [],
  failures = [];
const external = new Connection(require("./fixture.cjs").target);
let app, page;
const command = (id, args = {}) =>
  page.evaluate(({ id, args }) => window.lwrCommands.execute(id, args), {
    id,
    args,
  });
const state = () => command("workspace.state", { readOnly: true });
async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({
      name,
      status: "passed",
      ms: Math.round(performance.now() - start),
    });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, status: "failed", error: String(error) });
    failures.push(error);
    console.error("FAIL", name, error);
    await page
      ?.screenshot({ path: path.join(workspace, "artifacts/ui-failure.png") })
      .catch(() => {});
    throw error;
  }
}
async function waitState(predicate) {
  await page.waitForFunction(predicate, undefined, { timeout: 12000 });
}
async function externalEdit(file, text) {
  const original = await external.download({ path: file });
  await external.request("save", {
    path: file,
    text,
    revision: original.revision,
  });
}
(async () => {
  const started = performance.now();
  app = await electron.launch({
    ...(process.env.LWR_PACKAGED
      ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
      : { args: [workspace] }),
    env: {
      ...process.env,
      LWR_ROOT: fixture.root,
      LWR_USER_DATA: path.join(workspace, "artifacts/ui-profile"),
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) =>
    console.error("RENDERER ERROR", error.message),
  );
  await test("launch, real SSH, first listing, one default group", async () => {
    await page
      .locator('[data-testid="explorer-tree"][data-ready="true"]')
      .waitFor();
    const elapsed = performance.now() - started;
    assert.equal(await page.locator(".editor-group").count(), 1);
    console.log("First directory ready:", Math.round(elapsed), "ms");
  });
  await external.connect();
  // Each run starts from a known fixture state; only acceptance files are changed.
  await externalEdit(
    fixture.root + "/notes.md",
    "# Notes\n\nThis file is safe to edit during acceptance testing.\n",
  );
  await externalEdit(
    fixture.root + "/vim-test.txt",
    "alpha beta gamma\nsecond line\n",
  );
  await test("command palette keyboard search toggles Vim and exposes named commands", async () => {
    if ((await state()).vimMode) await command("editor.vim");
    await page.keyboard.press("Control+Shift+P");
    await page
      .getByRole("textbox", { name: "Search commands" })
      .fill("toggle vim");
    await page.keyboard.press("Enter");
    await waitState(
      () =>
        document
          .querySelector('[aria-label="Toggle Vim mode"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    const commands = await page.evaluate(() => window.lwrCommands.list());
    fs.writeFileSync(
      path.join(workspace, "artifacts/commands.json"),
      JSON.stringify(commands, null, 2),
    );
    assert.ok(commands.length >= 40);
    assert.ok(commands.some((item) => item.id === "window.reload"));
    await command("editor.vim");
  });
  await test("Markdown: four math pairs, Mermaid SVG, highlighted fences and real image", async () => {
    await page.locator(".tree-row").filter({ hasText: "README.md" }).click();
    await page.locator(".markdown-preview").waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".katex").length === 4,
    );
    await page.locator(".diagram svg").waitFor();
    for (const label of [
      "Your agents",
      "Remote files",
      "LWR workspace",
      "Review and edit",
    ])
      assert.ok(
        (await page.locator(".diagram svg").textContent()).includes(label),
        `Mermaid label: ${label}`,
      );
    assert.ok(
      (await page.locator(".markdown-preview pre .hljs-keyword").count()) > 0,
    );
    await page.waitForFunction(
      () => document.querySelector(".remote-image img")?.naturalWidth > 0,
    );
    assert.equal(
      await page.locator(".markdown-preview code .katex").count(),
      0,
      "Code delimiters remain literal",
    );
    await page.screenshot({
      path: path.join(workspace, "artifacts/markdown-proof.png"),
    });
    await command("markdown.both");
    await page.locator(".cm-editor").waitFor();
    assert.equal(await page.locator(".markdown-preview").count(), 1);
  });
  await test("Markdown image parsing: reference links, spaces, Unicode, ancestor fallback and missing paths", async () => {
    await command("file.open", { path: fixture.root + "/docs/topic/paths.md" });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".remote-image img")].filter(
          (image) => image.naturalWidth > 0,
        ).length === 4,
    );
    await page.locator(".image-error").waitFor();
    assert.ok(
      (await page.locator(".image-error").textContent()).includes("Tried:"),
    );
    await command("file.open", { path: fixture.root + "/README.md" });
  });
  await test("six nested groups, both split directions, drag resize, move and close tabs", async () => {
    for (let i = 0; i < 5; i++) {
      await command(i % 2 ? "group.splitDown" : "group.splitRight");
      await page.waitForTimeout(100);
    }
    assert.equal(await page.locator(".editor-group").count(), 6);
    await command("markdown.source");
    assert.equal(
      await page.locator(".markdown-preview").count(),
      5,
      "Preview mode is independent in each tab group",
    );
    const separator = page.locator(".editor-area > .split > .split-handle");
    const bounds = await separator.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(bounds.x - 45, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.notEqual((await state()).layout.ratio, 0.5);
    await command("group.equalize");
    await command("group.moveTab");
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".editor-group").count(), 5);
    const collect = (node) =>
      node.kind === "group"
        ? [node.group]
        : [...collect(node.first), ...collect(node.second)];
    const all = collect((await state()).layout);
    for (const group of all.slice(1)) {
      await command("file.close", { path: group.active, group: group.id });
      await page.waitForTimeout(100);
    }
    assert.equal(await page.locator(".editor-group").count(), 1);
  });
  await test("explicit save, dirty dot, no autosave, and clean-buffer agent refresh", async () => {
    await command("file.open", { path: fixture.root + "/notes.md" });
    await command("markdown.source");
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nUser edit from UI.\n");
    await page.locator(".dirty-dot").waitFor();
    await command("markdown.preview");
    await command("markdown.source");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+z");
    assert.ok(
      !(await page.locator(".cm-content").textContent()).includes(
        "User edit from UI.",
      ),
    );
    await page.keyboard.press("Control+y");
    assert.ok(
      (await page.locator(".cm-content").textContent()).includes(
        "User edit from UI.",
      ),
    );
    assert.ok(
      !(
        await external.download({ path: fixture.root + "/notes.md" })
      ).text.includes("User edit from UI."),
    );
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !document.querySelector(".dirty-dot"));
    assert.ok(
      (
        await external.download({ path: fixture.root + "/notes.md" })
      ).text.includes("User edit from UI."),
    );
    await externalEdit(
      fixture.root + "/notes.md",
      "# Notes\n\nAgent changed this clean buffer.\n",
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".cm-content")
        ?.textContent.includes("Agent changed this clean buffer."),
    );
  });
  await test("concurrent save conflict preserves edits and offers explicit comparison", async () => {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nUnsaved local work.\n");
    await externalEdit(
      fixture.root + "/notes.md",
      "# Notes\n\nNew remote version wins until explicit replacement.\n",
    );
    await page.keyboard.press("Control+s");
    await page
      .getByRole("dialog", { name: "Compare conflicting changes" })
      .waitFor();
    assert.ok(
      (await page.getByText("Unsaved local work.", { exact: false }).count()) >
        0,
    );
    assert.ok(
      (
        await external.download({ path: fixture.root + "/notes.md" })
      ).text.includes("New remote version wins"),
    );
    await page.screenshot({
      path: path.join(workspace, "artifacts/conflict-proof.png"),
    });
    await page
      .getByRole("button", { name: "Replace file with my edits" })
      .click();
    await page
      .getByRole("dialog", { name: "Compare conflicting changes" })
      .waitFor({ state: "hidden" });
    assert.ok(
      (
        await external.download({ path: fixture.root + "/notes.md" })
      ).text.includes("Unsaved local work."),
    );
  });
  await test("structured conflict commands require explicit revision approval and reject a newer writer", async () => {
    const path = fixture.root + "/notes.md";
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nLocal API resolution.\n");
    await externalEdit(path, "Remote API version one.\n");
    await command("file.save");
    const approval = await command("conflict.replace");
    assert.equal(approval.confirmationRequired, true);
    assert.equal(
      (await external.download({ path })).text,
      "Remote API version one.\n",
    );
    await assert.rejects(
      command("conflict.replace", { confirmed: true, revision: "stale" }),
      /compared version changed/,
    );
    await externalEdit(path, "Remote API version two.\n");
    assert.equal(
      await command("conflict.replace", {
        confirmed: true,
        revision: approval.revision,
      }),
      false,
    );
    assert.equal(
      (await external.download({ path })).text,
      "Remote API version two.\n",
    );
    const latest = (await state()).documents.find(
      (doc) => doc.path === path,
    ).conflictRevision;
    assert.equal(
      await command("conflict.replace", { confirmed: true, revision: latest }),
      true,
    );
    assert.ok(
      (await external.download({ path })).text.includes(
        "Local API resolution.",
      ),
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nDiscard only after approval.\n");
    await externalEdit(path, "Remote API version three.\n");
    await command("file.save");
    await command("conflict.keepEditing");
    await page
      .getByRole("dialog", { name: "Compare conflicting changes" })
      .waitFor({ state: "hidden" });
    assert.ok((await page.locator(".dirty-dot").count()) > 0);
    const remoteApproval = await command("conflict.useRemote");
    assert.equal(remoteApproval.confirmationRequired, true);
    await command("conflict.useRemote", {
      confirmed: true,
      revision: remoteApproval.revision,
    });
    await page.waitForFunction(() => !document.querySelector(".dirty-dot"));
    assert.equal(
      (await page.locator(".cm-content").textContent()).trim(),
      "Remote API version three.",
    );
  });
  await test("Vim insert, motion/operator, undo, search and :w / :q safeguards", async () => {
    await command("file.open", { path: fixture.root + "/vim-test.txt" });
    if (!(await state()).vimMode) await command("editor.vim");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.type("gg0dw");
    await page.keyboard.press("u");
    assert.ok(
      (await page.locator(".cm-content").textContent()).includes("alpha"),
    );
    await page.keyboard.press("Control+r");
    assert.ok(
      !(await page.locator(".cm-content").textContent()).includes("alpha"),
    );
    await page.keyboard.press("u");
    await page.keyboard.type("/second");
    await page.keyboard.press("Enter");
    assert.ok(
      (await page.locator(".cm-activeLine").textContent()).includes("second"),
      "Vim /second must navigate without changing the buffer",
    );
    await page.keyboard.press("v");
    assert.ok(
      (await page.locator(".cm-vim-panel").textContent())
        .toUpperCase()
        .includes("VISUAL"),
    );
    await page.keyboard.press("y");
    await page.keyboard.type("gg0");
    await page.keyboard.press("i");
    await page.keyboard.type("Vim edit ");
    await page.keyboard.press("Escape");
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".dirty-dot"));
    assert.ok(
      (
        await external.download({ path: fixture.root + "/vim-test.txt" })
      ).text.includes("Vim edit"),
    );
    await page.keyboard.press("i");
    await page.keyboard.type("unsaved ");
    await page.keyboard.press("Escape");
    await page.keyboard.type(":q");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: /Discard changes/ }).waitFor();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    assert.ok((await page.locator(".dirty-dot").count()) > 0);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.type(":wq");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => !document.querySelector('[role="tab"][title$="vim-test.txt"]'),
    );
    await command("editor.vim");
  });
  await test("integrated terminal owlet . opens another local window with same root", async () => {
    await command("terminal.focus");
    await page.waitForTimeout(1000);
    const nextWindow = app.waitForEvent("window");
    await page.keyboard.type("owlet .");
    await page.keyboard.press("Enter");
    const second = await nextWindow;
    await second.locator('[data-ready="true"]').waitFor();
    assert.equal(
      (
        await second.evaluate(() =>
          window.lwrCommands.execute("workspace.state", { readOnly: true }),
        )
      ).root,
      fixture.root,
    );
    const closed = second.waitForEvent("close");
    await second
      .evaluate(() => window.lwr.closeWindow())
      .catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
    await closed;
  });
  await test("disconnect/reconnect preserves dirty buffers and requires explicit new shell", async () => {
    await command("file.open", { path: fixture.root + "/notes.md" });
    await command("markdown.source");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nPreserve this across disconnect.\n");
    await command("connection.disconnect");
    await page
      .getByRole("button", { name: "Reconnect", exact: true })
      .waitFor();
    assert.ok(
      (await page.locator(".cm-content").textContent()).includes(
        "Preserve this across disconnect.",
      ),
    );
    await command("connection.reconnect");
    await page
      .getByRole("button", { name: "Start new shell", exact: true })
      .waitFor();
    assert.ok((await page.locator(".dirty-dot").count()) > 0);
    await command("file.save");
    await page.waitForFunction(() => !document.querySelector(".dirty-dot"));
    await page
      .getByRole("button", { name: "Start new shell", exact: true })
      .click();
  });
  await test("hide/show terminal preserves the shell and reload remains available", async () => {
    const before = await page.locator(".xterm-screen").count();
    await command("terminal.toggle");
    await command("terminal.toggle");
    assert.equal(await page.locator(".xterm-screen").count(), before);
    const reloaded = page.waitForEvent("domcontentloaded");
    await command("window.reload").catch((error) => {
      if (!String(error).includes("Execution context was destroyed"))
        throw error;
    });
    await reloaded;
    await page.locator('[data-ready="true"]').waitFor();
    assert.equal(await page.locator(".editor-group").count(), 1);
  });
  await command("file.open", { path: fixture.root + "/README.md" });
  await page.locator(".diagram svg").waitFor();
  await page.screenshot({
    path: path.join(workspace, "artifacts/workspace-proof.png"),
  });
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(workspace, "artifacts/ui-results.json"),
      JSON.stringify({ results, failures: failures.length }, null, 2),
    );
    external.close();
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
  });
