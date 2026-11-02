const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/explorer-reveal-"));
const root = path.join(base, "Project").replaceAll("\\", "/");
for (const dir of ["src/deep", "other", ".private", "bulk", "slow/child"])
  fs.mkdirSync(root + "/" + dir, { recursive: true });
for (const name of [
  "src/deep/note.ts",
  "other/second.txt",
  ".private/.hidden.md",
  "slow/child/slow.txt",
])
  fs.writeFileSync(root + "/" + name, "// Reading the agent’s work\n");
for (let i = 0; i < 145; i++)
  fs.writeFileSync(
    root + "/bulk/file-" + String(i).padStart(3, "0") + ".txt",
    "text",
  );
fs.writeFileSync(path.join(base, "outside.txt"), "outside");
let app;
const results = [],
  errors = [];
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
async function revealed(page, file) {
  await page
    .waitForFunction((file) => {
      const row = document.querySelector(".tree-row.selected"),
        tree = document.querySelector(".tree");
      if (row?.getAttribute("data-file-path") !== file) return false;
      const r = row.getBoundingClientRect(),
        t = tree.getBoundingClientRect();
      return r.height > 0 && r.top >= t.top - 1 && r.bottom <= t.bottom + 1;
    }, file)
    .catch(async (error) => {
      console.error(
        "Reveal diagnostic",
        await page.evaluate(() => ({
          selected: document.querySelector(".tree-row.selected")?.outerHTML,
          tree: document.querySelector(".tree")?.innerText,
          viewport: document
            .querySelector(".tree")
            ?.getBoundingClientRect()
            .toJSON(),
          row: document
            .querySelector(".tree-row.selected")
            ?.getBoundingClientRect()
            .toJSON(),
        })),
      );
      console.error(
        "Lists",
        await app.evaluate(() => globalThis.__revealLists),
      );
      throw error;
    });
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest(".explorer")),
    false,
    "Reveal must not steal keyboard focus",
  );
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
  await app.evaluate(({ app }) => {
    const require = process.mainModule.require.bind(process.mainModule);
    globalThis.__revealLists = [];
    globalThis.__delayList = "";
    for (const [file, name] of [
      ["local.cjs", "LocalConnection"],
      ["connection.cjs", "Connection"],
    ]) {
      const type = require(
          require("path").join(app.getAppPath(), "electron", file),
        )[name],
        original = type.prototype.request;
      type.prototype.request = async function (method, args) {
        if (method === "list") {
          globalThis.__revealLists.push({ ...args });
          if (args.path === globalThis.__delayList)
            await new Promise((r) => setTimeout(r, 700));
        }
        return original.call(this, method, args);
      };
    }
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.locator('[data-ready="true"]').waitFor();
  await cmd(page, "terminal.toggle", { visible: false });
  await page.keyboard.press("Control+p");
  await page
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("src/deep/note.ts");
  await page.getByRole("option").filter({ hasText: "note.ts" }).first().click();
  await page.locator(".cm-content").focus();
  await revealed(page, root + "/src/deep/note.ts");
  const first = (await cmd(page, "workspace.state", { readOnly: true }))
    .activeGroup;
  await cmd(page, "explorer.collapse");
  assert.equal(await page.locator(".tree-row.selected").count(), 0);
  await page.getByRole("tab").filter({ hasText: "note.ts" }).click();
  await revealed(page, root + "/src/deep/note.ts");
  await cmd(page, "file.open", { path: root + "/other/second.txt" });
  await revealed(page, root + "/other/second.txt");
  await page.getByRole("tab").filter({ hasText: "note.ts" }).click();
  await revealed(page, root + "/src/deep/note.ts");
  await cmd(page, "group.splitRight");
  const second = (await cmd(page, "workspace.state", { readOnly: true }))
    .activeGroup;
  await cmd(page, "file.open", {
    path: root + "/other/second.txt",
    group: second,
  });
  await revealed(page, root + "/other/second.txt");
  await page.locator(`[data-group="${first}"] .cm-content`).click();
  await revealed(page, root + "/src/deep/note.ts");
  await cmd(page, "group.focus", { group: second });
  await revealed(page, root + "/other/second.txt");
  results.push(
    "Ctrl+P, tab clicks, reactivating the same collapsed tab, and split-group focus reveal the file without stealing focus",
  );
  await cmd(page, "file.open", { path: root + "/bulk/file-144.txt" });
  await revealed(page, root + "/bulk/file-144.txt");
  assert(
    await app.evaluate(() =>
      globalThis.__revealLists.some(
        (r) => r.path.endsWith("/bulk") && r.offset >= 100,
      ),
    ),
    "Must load beyond the first directory page",
  );
  await cmd(page, "explorer.refresh");
  await page.waitForTimeout(500);
  await revealed(page, root + "/bulk/file-144.txt");
  await cmd(page, "file.open", { path: root + "/.private/.hidden.md" });
  await revealed(page, root + "/.private/.hidden.md");
  assert.equal(
    await page.getByRole("checkbox", { name: "Show hidden files" }).isChecked(),
    false,
  );
  await cmd(page, "file.open", { path: root + "/other/second.txt" });
  assert.equal(
    await page.locator(".tree-row").filter({ hasText: ".private" }).count(),
    0,
  );
  await cmd(page, "explorer.toggle");
  await cmd(page, "file.open", { path: root + "/src/deep/note.ts" });
  assert.equal(await page.locator(".explorer").isVisible(), false);
  await cmd(page, "explorer.toggle");
  await revealed(page, root + "/src/deep/note.ts");
  results.push(
    "Pagination, refresh, hidden active paths, and reopening a hidden sidebar preserve correct selection and scroll",
  );
  // A delayed response for a previous tab may populate cache, but must not continue its reveal.
  await app.evaluate((p) => {
    globalThis.__delayList = p;
    globalThis.__revealLists = [];
  }, root + "/slow");
  await cmd(page, "file.open", { path: root + "/slow/child/slow.txt" });
  await page.waitForTimeout(100);
  await cmd(page, "tab.activate", {
    path: root + "/other/second.txt",
    group: second,
  });
  await revealed(page, root + "/other/second.txt");
  await page.waitForTimeout(900);
  await revealed(page, root + "/other/second.txt");
  assert.equal(
    await app.evaluate(
      (p) => globalThis.__revealLists.filter((r) => r.path === p).length,
      root + "/slow/child",
    ),
    0,
  );
  await cmd(page, "settings.open");
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".tree-row.selected").count(), 0);
  await cmd(page, "file.open", {
    path: path.join(base, "outside.txt").replaceAll("\\", "/"),
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".tree-row.selected").count(), 0);
  // Case variants in local Windows paths map back to the actual row.
  await cmd(page, "file.open", {
    path: (root + "/src/deep/note.ts").toUpperCase(),
  });
  await revealed(page, root + "/src/deep/note.ts");
  results.push(
    "Rapid tab switches cancel stale traversal; Settings/outside files have no tree target; Windows case variants select the real row",
  );
  if (process.env.OWLET_SSH_TARGET) {
    const { python } = require("./fixture.cjs");
    const remoteRoot = python(
      'import tempfile,os; p=tempfile.mkdtemp(prefix="owlet-reveal-"); os.makedirs(p+"/src/deep"); open(p+"/src/deep/note.txt","w").write("hello"); print(p)',
    );
    const next = app.waitForEvent("window");
    await cmd(page, "workspace.openSSH", {
      target: process.env.OWLET_SSH_TARGET,
      path: remoteRoot,
    });
    const remote = await next;
    remote.on("pageerror", (e) => errors.push(e.message));
    await remote.locator('[data-ready="true"]').waitFor();
    await cmd(remote, "file.open", { path: remoteRoot + "/src/deep/note.txt" });
    await remote.locator(".cm-content").focus();
    await revealed(remote, remoteRoot + "/src/deep/note.txt");
    await cmd(remote, "explorer.collapse");
    await cmd(remote, "tab.activate", {
      path: remoteRoot + "/src/deep/note.txt",
    });
    await revealed(remote, remoteRoot + "/src/deep/note.txt");
    results.push("Real SSH folder traversal and same-tab reactivation");
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", base, results }, null, 2));
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
