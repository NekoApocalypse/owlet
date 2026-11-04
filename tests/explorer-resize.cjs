const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(path.join(workspace, "artifacts/explorer-resize-"));
const root = path.join(base, "Resize review").replaceAll("\\", "/");
fs.mkdirSync(root + "/a-target", { recursive: true });
fs.writeFileSync(
  root + "/a-note.md",
  "# Resize the Explorer\n\nGrab the edge without moving a file.\n",
);
for (let i = 0; i < 100; i++)
  fs.writeFileSync(root + `/file-${String(i).padStart(3, "0")}.txt`, "text");
let app;
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
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd("workspace.state", { readOnly: true });
  await cmd("terminal.toggle", { visible: false });
  await cmd("file.open", { path: root + "/a-note.md" });
  await page.evaluate(() => {
    window.__fileDrags = 0;
    document.addEventListener("dragstart", (e) => {
      if (e.target.closest(".tree-row")) window.__fileDrags++;
    });
  });
  const handle = page.getByRole("separator", { name: "Resize Explorer" });
  const row = page.locator(".tree-row").filter({ hasText: "a-note.md" });
  for (const offset of [0.5, 4, 7.5, 9, 11.5]) {
    await cmd("explorer.setWidth", { width: 252 });
    const h = await handle.boundingBox(),
      r = await row.boundingBox();
    assert.equal(h.width, 12);
    assert(r.x + r.width <= h.x, "Rows must end before the resize zone");
    const x = h.x + offset,
      y = r.y + r.height / 2;
    assert(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.classList.contains("sidebar-handle"),
        { x, y },
      ),
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 12 });
    await page.waitForFunction(() =>
      window.owletCommands
        .execute("workspace.state", { readOnly: true })
        .then((s) => s.sidebar.width === 312),
    );
    await page.mouse.move(x - 35, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() =>
      window.owletCommands
        .execute("workspace.state", { readOnly: true })
        .then((s) => s.sidebar.width === 217),
    );
    assert.equal(
      (await state()).sidebar.width,
      217,
      "Width follows pointer delta without a grab-position jump",
    );
    await page.mouse.move(x + 100, y);
    assert.equal((await state()).sidebar.width, 217, "Release stops resizing");
  }
  assert.equal(
    await page.evaluate(() => window.__fileDrags),
    0,
    "Gutter drags must never start a file drag",
  );
  assert(!(await state()).confirmation);
  await cmd("explorer.setWidth", { width: 280 });
  const tree = await page.locator(".tree").boundingBox(),
    h = await handle.boundingBox();
  assert(
    tree.x + tree.width <= h.x,
    "Scrollbar must remain outside the resize hit area",
  );
  const sidebar = await page.locator(".sidebar-wrap").boundingBox();
  assert.equal(
    tree.x + tree.width,
    sidebar.x + sidebar.width,
    "Explorer scrollbar must reach the sidebar edge without an inset gutter",
  );
  const thumbColor = () =>
    page
      .locator(".tree")
      .evaluate((el) =>
        getComputedStyle(el)
          .getPropertyValue("--explorer-scrollbar-color")
          .trim(),
      );
  const waitThumb = async (color) => {
    await page
      .waitForFunction(
        (color) =>
          getComputedStyle(document.querySelector(".tree"))
            .getPropertyValue("--explorer-scrollbar-color")
            .trim() === color,
        color,
      )
      .catch(async (error) => {
        console.error(
          await page.locator(".tree").evaluate((el) => ({
            hover: el.matches(":hover"),
            color: getComputedStyle(el).getPropertyValue(
              "--explorer-scrollbar-color",
            ),
            thumb: getComputedStyle(el, "::-webkit-scrollbar-thumb")
              .backgroundColor,
          })),
        );
        await page.screenshot({
          path: path.join(base, "scrollbar-failure.png"),
        });
        throw error;
      });
    assert.equal(await thumbColor(), color);
  };
  await page.mouse.move(h.x + 100, tree.y + 20);
  await waitThumb("rgba(0, 0, 0, 0)");
  const idleWidth = await page
    .locator(".tree")
    .evaluate((el) => el.clientWidth);
  await page.screenshot({ path: path.join(base, "scrollbar-idle.png") });
  await page.locator(".tree").hover();
  await waitThumb("rgb(64, 79, 125)");
  assert.equal(
    await page.locator(".tree").evaluate((el) => el.clientWidth),
    idleWidth,
    "Showing the thumb must not shift the file rows",
  );
  await page.screenshot({ path: path.join(base, "scrollbar-hover.png") });
  await page.mouse.wheel(0, 450);
  await page.waitForFunction(
    () => document.querySelector(".tree").scrollTop > 0,
  );
  assert.equal((await state()).sidebar.width, 280);
  await page.mouse.move(h.x + 100, tree.y + 20);
  await waitThumb("rgba(0, 0, 0, 0)");
  // Programmatic reveals/keyboard scrolling should show the thumb even without hover.
  await page.locator(".tree").evaluate((el) => {
    el.scrollTop += 200;
  });
  await waitThumb("rgb(64, 79, 125)");
  await waitThumb("rgba(0, 0, 0, 0)");
  await page.locator(".tree").evaluate((el) => {
    el.scrollTop = 0;
  });
  // The thumb itself remains draggable and does not enter the resize deadzone.
  await page.mouse.move(tree.x + tree.width - 4, tree.y + 15);
  await page.mouse.down();
  await page.mouse.move(tree.x + tree.width - 4, tree.y + 150, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector(".tree").scrollTop > 0,
  );
  assert.equal((await state()).sidebar.width, 280);
  assert.equal(await page.evaluate(() => window.__fileDrags), 0);
  await page.locator(".tree").evaluate((el) => {
    el.scrollTop = 0;
  });
  await row.dragTo(page.locator(".tree-row").filter({ hasText: "target" }));
  await page.waitForFunction(() =>
    window.owletCommands
      .execute("workspace.state", { readOnly: true })
      .then((s) => !!s.confirmation),
  );
  assert.equal(await page.evaluate(() => window.__fileDrags), 1);
  const confirmation = (await state()).confirmation;
  await cmd("confirmation.accept", { token: confirmation.token });
  assert(fs.existsSync(root + "/a-target/a-note.md"));
  assert.equal(
    (await state()).sidebar.width,
    280,
    "File drags must not resize the Explorer",
  );
  await page.mouse.move(h.x + 3, tree.y + 45);
  await page.screenshot({ path: path.join(base, "explorer-resize.png") });
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "12px resize zone across row edges",
          "No file drag during resize",
          "No initial width jump; capture and release",
          "Scrollbar remains separate",
          "Flush scrollbar, hover/scroll visibility and idle fade without layout shift",
          "Native scrollbar dragging does not resize or drag files",
          "Normal file drag still moves through confirmation",
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
