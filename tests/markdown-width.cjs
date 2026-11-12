const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = fs.mkdtempSync(path.resolve("artifacts/markdown-width-"));
const root = path.join(base, "Workspace"),
  profile = path.join(base, "profile");
fs.mkdirSync(root);
const file = path.join(root, "Reading.md").replaceAll("\\", "/"),
  settings = "owlet://user/settings.json";
fs.writeFileSync(
  file,
  "# A comfortable reading width\n\n" +
    "Inspect the details without losing your place. ".repeat(35) +
    "\n\n## A second section\n\n```js\nconst width = 640;\n```\n",
);
let app;
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [path.resolve("."), "--local", root] }),
    env: { ...process.env, OWLET_USER_DATA: profile },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 900),
  );
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}, p = page) =>
    p.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  await cmd("terminal.toggle", { visible: false });
  await cmd("file.open", { path: file });
  await page.locator(".markdown-preview h1").waitFor();
  assert.equal(
    await page
      .locator(".markdown-preview h1")
      .evaluate((el) => getComputedStyle(el).maxWidth),
    "900px",
  );
  await cmd("settings.open");
  await page.locator(".settings-content").waitFor();
  const centered = await page.locator(".settings-content").evaluate((el) => {
    const parent = el.parentElement,
      box = el.getBoundingClientRect(),
      outer = parent.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - (outer.x + parent.clientWidth / 2));
  });
  assert(centered < 1, "Settings content is centered within its pane");
  await page.screenshot({ path: path.join(base, "settings-centered.png") });
  await page
    .getByRole("textbox", { name: "Search settings" })
    .fill("maximum width");
  const input = page.locator('[data-setting="preview.maxWidth"] input');
  await input.fill("640");
  assert.equal(
    (await cmd("settings.inspect")).values["preview.maxWidth"],
    900,
    "Edits wait for Save",
  );
  await page.screenshot({ path: path.join(base, "maximum-width-setting.png") });
  await cmd("settings.json");
  assert.match(
    (await cmd("file.inspect", { path: settings, readOnly: true })).text,
    /"preview.maxWidth": 640/,
  );
  assert.equal(await cmd("settings.save"), true);
  await cmd("tab.activate", { path: file, group: 1 });
  assert.equal(
    await page
      .locator(".markdown-preview h1")
      .evaluate((el) => el.getBoundingClientRect().width),
    640,
  );
  await page.screenshot({ path: path.join(base, "markdown-640.png") });
  await cmd("group.splitRight", { group: 1, path: file });
  assert.equal(await page.locator(".markdown-preview").count(), 2);
  assert.deepEqual(
    await page
      .locator(".markdown-preview h1")
      .evaluateAll((items) => items.map((el) => getComputedStyle(el).maxWidth)),
    ["640px", "640px"],
  );
  for (const width of [-1, 10001, 3.5, "900px"])
    await assert.rejects(
      cmd("settings.update", { key: "preview.maxWidth", value: width }),
    );
  await cmd("settings.update", { key: "preview.maxWidth", value: 0 });
  assert.equal(await cmd("settings.save"), true);
  assert.deepEqual(
    await page
      .locator(".markdown-preview h1")
      .evaluateAll((items) => items.map((el) => getComputedStyle(el).maxWidth)),
    ["none", "none"],
  );
  for (const fits of await page
    .locator(".markdown-preview")
    .evaluateAll((items) =>
      items.map((el) => {
        const css = getComputedStyle(el),
          width =
            el.getBoundingClientRect().width -
            parseFloat(css.paddingLeft) -
            parseFloat(css.paddingRight);
        return (
          Math.abs(
            el.querySelector("h1").getBoundingClientRect().width - width,
          ) < 1
        );
      }),
    ))
    assert(fits, "Unlimited width fills each pane without overflowing it");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8"))[
      "preview.maxWidth"
    ],
    0,
  );
  // A fresh window reads the saved config; later edits broadcast to that window too.
  const next = app.waitForEvent("window");
  await cmd("workspace.openLocal", { path: root });
  const second = await next;
  await second.locator('[data-ready="true"]').waitFor();
  await cmd("file.open", { path: file }, second);
  await second.locator(".markdown-preview h1").waitFor();
  assert.equal(
    (await cmd("settings.inspect", {}, second)).values["preview.maxWidth"],
    0,
  );
  await cmd("settings.reset", { key: "preview.maxWidth" });
  assert.equal(await cmd("settings.save"), true);
  await second.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".markdown-preview h1"))
        .maxWidth === "900px",
  );
  assert.equal(
    Object.hasOwn(
      JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")),
      "preview.maxWidth",
    ),
    false,
  );
  // Narrow Settings panes wrap controls inside the same centered column.
  await cmd("settings.open", { group: 1 });
  await page.locator('[data-group="1"] .settings-view').waitFor();
  assert(
    await page
      .locator(".settings-view")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.screenshot({ path: path.join(base, "settings-narrow.png") });
  console.log(
    JSON.stringify(
      {
        passed: true,
        base,
        checks: [
          "Centered and narrow Settings layout",
          "UI/JSON shared buffer and explicit Save",
          "Bounded and unlimited widths in split panes",
          "Validation, persistence, new-window loading, broadcast and reset",
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
