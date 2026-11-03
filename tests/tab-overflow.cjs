const { _electron } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/tab-overflow-"));
const root = path.join(base, "Tab review").replaceAll("\\", "/");
fs.mkdirSync(root);
const files = Array.from(
  { length: 18 },
  (_, i) => `${root}/Reading-plan-${String(i).padStart(2, "0")}.md`,
);
for (const file of files)
  fs.writeFileSync(
    file,
    "# A quiet tab strip\n\nScroll through tabs without a scrollbar taking up space.\n",
  );
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
  await cmd("terminal.toggle", { visible: false });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setContentSize(1100, 720);
  });
  for (const file of files) await cmd("file.open", { path: file });
  const activeVisible = () =>
    page.waitForFunction(() => {
      const el = document.querySelector(".active-group .tabs"),
        tab = el.querySelector(".active-tab");
      const a = el.getBoundingClientRect(),
        b = tab.getBoundingClientRect();
      return b.left >= a.left - 1 && b.right <= a.right + 1;
    });
  await activeVisible();
  await page.locator(".tab-overflow-left").waitFor();
  assert.equal(await page.locator(".tab-overflow-right").count(), 0);
  const geometry = await page
    .locator(".tabs")
    .evaluate((el) => ({
      client: el.clientHeight,
      total: el.offsetHeight,
      scroll: el.scrollHeight,
      bar: getComputedStyle(el).scrollbarWidth,
      webkit: getComputedStyle(el, "::-webkit-scrollbar").display,
    }));
  assert.equal(geometry.client, geometry.total);
  assert.equal(geometry.scroll, geometry.client);
  assert.equal(geometry.bar, "none");
  assert.equal(geometry.webkit, "none");
  await cmd("tab.activate", { path: files[0] });
  await activeVisible();
  await page.locator(".tab-overflow-right").waitFor();
  assert.equal(await page.locator(".tab-overflow-left").count(), 0);
  await page.locator(".tabs").hover();
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(
    () => document.querySelector(".tabs").scrollLeft > 100,
  );
  await page.locator(".tab-overflow-left").waitFor();
  await page.locator(".tab-overflow-right").waitFor();
  assert.equal(
    await page
      .locator(".tab-overflow")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width),
    8,
  );
  await cmd("tab.activate", { path: files[9] });
  await activeVisible();
  await cmd("explorer.setWidth", { width: 450 });
  await activeVisible();
  const group = await page.locator(".editor-group").boundingBox(),
    actions = await page.locator(".group-actions").boundingBox();
  assert(
    actions.x + actions.width <= group.x + group.width + 1,
    "Split controls remain inside their group",
  );
  await page.screenshot({ path: path.join(base, "tab-overflow.png") });
  await cmd("group.splitRight");
  const second = (await cmd("workspace.state", { readOnly: true })).activeGroup;
  // Splitting duplicates the active tab; the new group starts with one tab.
  assert.equal(
    await page.locator(`[data-group="${second}"] .tab-overflow`).count(),
    0,
    "A short second strip has no unnecessary indicators",
  );
  await cmd("group.focus", { group: 1 });
  for (let i = 1; i < files.length; i++)
    await cmd("file.close", { path: files[i], group: 1 });
  await page.waitForFunction(
    () => !document.querySelector('[data-group="1"] .tab-overflow'),
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        base,
        checks: [
          "No horizontal or vertical tab scrollbar",
          "8px overflow indicators track each edge",
          "Wheel scrolls the strip",
          "Active tab revealed on activation and resize",
          "Controls stay visible; split strips independent; indicators disappear when no longer needed",
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
