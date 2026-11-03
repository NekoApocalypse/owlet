const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(path.join(workspace, "artifacts/welcome-"));
const root = path.join(base, "Current"),
  other = path.join(base, "Other"),
  profile = path.join(base, "profile");
for (const dir of [root, other, profile]) fs.mkdirSync(dir);
fs.writeFileSync(path.join(root, "note.md"), "# A note\n");
const seed = Array.from({ length: 8 }, (_, i) => ({
  kind: "local",
  path: path.join(base, `Project ${i}`),
}));
for (const entry of seed) fs.mkdirSync(entry.path);
fs.writeFileSync(
  path.join(profile, "recent-workspaces.json"),
  JSON.stringify(seed),
);
let app;
const results = [],
  errors = [];
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
async function newWindow(action) {
  const waiting = app.waitForEvent("window");
  await action();
  const page = await waiting;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".welcome h1").waitFor();
  return page;
}
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('[data-ready="true"]').waitFor();
  const welcome = page.locator(".welcome");
  assert.equal(
    await welcome.getByRole("heading", { name: "Owlet", exact: true }).count(),
    1,
  );
  await welcome
    .getByText("Less between you and your work", { exact: true })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".welcome-recent").length === 6,
  );
  const recentRows = await page.locator(".welcome-recent").evaluateAll((rows) =>
    rows.map((row) => {
      const path = row.querySelector(".welcome-recent-path");
      const text = path.querySelector("bdi").firstChild;
      const tail = document.createRange();
      tail.setStart(text, Math.max(0, text.textContent.length - 3));
      tail.setEnd(text, text.textContent.length);
      return {
        height: row.getBoundingClientRect().height,
        rowHeight: parseFloat(
          getComputedStyle(row).getPropertyValue("--row-height"),
        ),
        pathRight: path.getBoundingClientRect().right,
        tailRight: tail.getBoundingClientRect().right,
      };
    }),
  );
  for (const row of recentRows) {
    assert.equal(row.height, row.rowHeight, "Recents use one compact row");
    assert(
      row.tailRight <= row.pathRight + 1,
      "The rightmost path stays inside its visible area",
    );
  }
  const rowStyles = await page
    .locator(".welcome-action, .welcome-recent")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const style = getComputedStyle(row);
        return [
          row.getBoundingClientRect().height,
          style.fontSize,
          style.padding,
          row.querySelector("svg").getBoundingClientRect().height,
        ];
      }),
    );
  for (const style of rowStyles)
    assert.deepEqual(
      style,
      rowStyles[0],
      "Start and Recents share row height, type size, padding and icon size",
    );
  // Start actions use the same command paths as the existing shortcuts.
  await welcome
    .getByRole("button", { name: "Search File", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Quick Open", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  await page.getByRole("dialog", { name: "Quick Open", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await welcome
    .getByRole("button", { name: "Command Palette", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Command palette", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("dialog", { name: "Command palette", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await cmd(page, "terminal.toggle", { visible: false });
  await welcome
    .getByRole("button", { name: "Open Terminal", exact: true })
    .click();
  await page.locator(".terminal-region").waitFor();
  await welcome
    .getByRole("button", { name: "Open Terminal", exact: true })
    .click();
  assert.equal(
    (await cmd(page, "workspace.state", { readOnly: true })).terminal.visible,
    true,
  );
  await page.keyboard.press("Control+Backquote");
  assert.equal(
    (await cmd(page, "workspace.state", { readOnly: true })).terminal.visible,
    false,
  );
  results.push(
    "Branding and five Start actions; search/palette shortcuts and idempotent Open Terminal",
  );
  // Stub the OS picker result, not Owlet's command or window creation.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, other);
  const folder = await newWindow(() =>
    welcome.getByRole("button", { name: "Open Folder", exact: true }).click(),
  );
  await folder.locator('[data-ready="true"]').waitFor();
  assert.equal(
    (await cmd(folder, "workspace.state", { readOnly: true })).root,
    other.replaceAll("\\", "/"),
  );
  await welcome
    .locator(".welcome-recent")
    .filter({ hasText: "Other" })
    .waitFor();
  const recent = await newWindow(() =>
    welcome.locator(".welcome-recent").filter({ hasText: "Other" }).click(),
  );
  await recent.locator('[data-ready="true"]').waitFor();
  assert.equal(
    (await cmd(recent, "workspace.state", { readOnly: true })).root,
    other.replaceAll("\\", "/"),
  );
  await welcome
    .getByRole("button", { name: "Open Recent…", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Recently Opened Windows" }).waitFor();
  assert((await page.getByRole("option").count()) > 6);
  await page.keyboard.press("Escape");
  results.push(
    "Open Folder dispatches native picker/window flow; inline local recent opens; More shows complete history; cross-window updates",
  );
  await welcome
    .getByRole("button", { name: "Connect Remote", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Connect to Remote", exact: true })
    .waitFor();
  if (process.env.OWLET_SSH_TARGET) {
    const remoteRoot = require("./fixture.cjs").python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-welcome-"))',
    );
    await page
      .getByRole("textbox", { name: "SSH host", exact: true })
      .fill(process.env.OWLET_SSH_TARGET);
    await page
      .getByRole("textbox", { name: "Remote folder", exact: true })
      .fill(remoteRoot);
    const remote = await newWindow(() =>
      page.getByRole("button", { name: "Connect", exact: true }).click(),
    );
    await remote.locator('[data-ready="true"]').waitFor();
    const row = welcome
      .locator(".welcome-recent")
      .filter({ hasText: process.env.OWLET_SSH_TARGET });
    await row.waitFor();
    const reopened = await newWindow(() => row.click());
    await reopened.locator('[data-ready="true"]').waitFor();
    const bootstrap = await reopened.evaluate(() => window.lwr.bootstrap());
    assert.equal(bootstrap.connection.kind, "ssh");
    assert.equal(bootstrap.connection.target, process.env.OWLET_SSH_TARGET);
    assert.equal(
      (await cmd(reopened, "workspace.state", { readOnly: true })).root,
      remoteRoot,
    );
    await remote
      .locator(".welcome")
      .getByRole("button", { name: "Connect Remote", exact: true })
      .click();
    await remote
      .getByRole("dialog", { name: "Connect to Remote", exact: true })
      .waitFor();
    await remote.getByRole("button", { name: "Cancel", exact: true }).click();
    results.push(
      "Connect Remote button opens real SSH workspace; inline SSH recent reconnects with the exact host/path; remote windows retain connection action",
    );
  } else
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const blank = await newWindow(() => cmd(page, "window.newEmpty"));
  assert(
    await blank
      .getByRole("button", { name: "Search File", exact: true })
      .isDisabled(),
  );
  assert(
    await blank
      .getByRole("button", { name: "Open Terminal", exact: true })
      .isDisabled(),
  );
  await blank
    .getByText("Open a folder to search files and use its terminal.", {
      exact: true,
    })
    .waitFor();
  // Container layout must work inside split groups, not only at a narrow window width.
  const window = await app.browserWindow(page);
  await window.evaluate((w) => {
    w.unmaximize();
    w.setContentSize(1100, 760);
  });
  await cmd(page, "group.splitRight");
  await page.waitForTimeout(100);
  const narrow = await page.locator(".welcome").evaluateAll((els) =>
    els.map((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      columns: getComputedStyle(el.querySelector(".welcome-sections"))
        .gridTemplateColumns,
    })),
  );
  for (const item of narrow) {
    assert(item.scroll <= item.width + 1, "No horizontal overflow in a split");
    assert.equal(
      item.columns.split(" ").length,
      1,
      "Narrow welcome stacks sections",
    );
  }
  await cmd(blank, "workspace.clearRecent");
  const state = await cmd(blank, "workspace.state", { readOnly: true });
  await cmd(blank, "confirmation.accept", { token: state.confirmation.token });
  await blank
    .getByText("Your recent local and remote workspaces will appear here.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await blank.locator(".welcome-recent").count(), 0);
  results.push(
    "Empty-window availability, narrow split layout, live history clearing and empty state",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", base, results }, null, 2));
  fs.writeFileSync(
    path.join(base, "results.json"),
    JSON.stringify(results, null, 2),
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
