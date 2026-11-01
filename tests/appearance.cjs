const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { python } = require("./fixture.cjs");
const workspace = path.resolve(__dirname, "..");
const fixture = require("../artifacts/fixture.json");
const root = python(
  `import os,tempfile,shutil\np=tempfile.mkdtemp(prefix='lwr-appearance-',dir=${JSON.stringify(require("./fixture.cjs").temporaryRoot)})\nos.mkdir(p+'/.vscode')\nos.mkdir(p+'/second')\nshutil.copyfile(${JSON.stringify(fixture.root)}+'/README.md',p+'/README.md')\nopen(p+'/.vscode/settings.json','w').write('{"peacock.remoteColor":"#fa9af4"}')\nprint(p)`,
);
let app;
const results = [];
(async () => {
  const started = performance.now();
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
      : { args: [workspace] }),
    env: {
      ...process.env,
      LWR_ROOT: root,
      LWR_USER_DATA: path.join(workspace, "artifacts/appearance-profile"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('[data-ready="true"]').waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".app-logo");
    return (
      image?.complete &&
      image.naturalWidth === 256 &&
      image.src.includes(".png")
    );
  });
  const readyMs = Math.round(performance.now() - started);
  const command = (id, args = {}, target = page) =>
    target.evaluate(({ id, args }) => window.lwrCommands.execute(id, args), {
      id,
      args,
    });
  const effective = (target) =>
    target.evaluate(
      () => getComputedStyle(document.querySelector(".topbar")).backgroundColor,
    );
  await command("view.zoom.reset");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 760),
  );
  const automatic = (await command("project.settings.get")).effectiveColor;
  assert.notEqual(automatic, "#fa9af4", "No implicit import from VS Code");
  assert.equal((await command("project.settings.get")).revision, null);
  await page.waitForFunction(() => navigator.windowControlsOverlay.visible);
  async function titlebarFits() {
    await page.waitForFunction(() => {
      const rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
      const toolbar = document
        .querySelector(".top-actions")
        .getBoundingClientRect();
      return toolbar.right <= rect.x + rect.width + 1 && toolbar.left >= 0;
    });
  }
  await titlebarFits();
  results.push({
    name: "native overlay and unconfigured automatic color",
    readyMs,
    automatic,
  });
  await page.keyboard.press("Control+Shift+P");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("import peacock");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".topbar")).backgroundColor ===
      "rgb(250, 154, 244)",
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".topbar")).color,
    ),
    "rgb(16, 24, 40)",
  );
  const setting = await page.evaluate(
    (root) =>
      window.lwr.remote("read", { path: root + "/.owlet/settings.json" }),
    root,
  );
  assert.deepEqual(JSON.parse(setting.text), { "peacock.color": "#fa9af4" });
  await command("message.dismiss");
  await command("file.open", { path: root + "/README.md" });
  await command("markdown.source");
  assert.equal(
    await page
      .locator(".cm-editor")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(0, 36, 81)",
  );
  assert.ok((await page.title()).includes("Owlet"));
  results.push({
    name: "palette import writes one key and preserves Tomorrow Night Blue editor",
  });
  const nextPromise = app.waitForEvent("window");
  await command("window.new");
  const second = await nextPromise;
  await second.locator('[data-ready="true"]').waitFor();
  await second.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".topbar")).backgroundColor ===
      "rgb(250, 154, 244)",
  );
  python(
    `open(${JSON.stringify(root)}+'/.vscode/settings.json','w').write('{"peacock.remoteColor":"#376b62"}')`,
  );
  await page.waitForTimeout(2300);
  assert.equal(await effective(page), "rgb(250, 154, 244)");
  const stale = await command("project.settings.get");
  python(
    `import json\nopen(${JSON.stringify(root)}+'/.owlet/settings.json','w').write(json.dumps({'peacock.color':'#355c7d','custom':True}))`,
  );
  for (const target of [page, second])
    await target.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".topbar")).backgroundColor ===
        "rgb(53, 92, 125)",
    );
  await assert.rejects(
    command("project.color.set", {
      color: "#fa9af4",
      revision: stale.revision,
    }),
    /CONFLICT/,
  );
  await command("project.color.reset");
  const reset = await page.evaluate(
    (root) =>
      window.lwr.remote("read", { path: root + "/.owlet/settings.json" }),
    root,
  );
  assert.deepEqual(JSON.parse(reset.text), { custom: true });
  results.push({
    name: "same-project windows share own config; VS Code changes ignored; stale saves rejected",
  });
  await second.close();
  const otherPromise = app.waitForEvent("window");
  await command("window.openFolder", { path: root + "/second" });
  const other = await otherPromise;
  await other.locator('[data-ready="true"]').waitFor();
  assert.notEqual(
    (await command("project.settings.get", {}, other)).effectiveColor,
    automatic,
  );
  await other.close();
  await command("window.maximize");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    ),
    true,
  );
  await titlebarFits();
  await command("window.maximize");
  await command("view.zoom.in");
  await titlebarFits();
  await command("view.zoom.reset");
  await command("window.fullscreen");
  await page.waitForTimeout(400);
  await page.waitForFunction(
    () =>
      document.querySelector(".topbar").getBoundingClientRect().width >
      innerWidth - 200,
  );
  assert.ok(
    await page
      .getByRole("button", { name: "Open command palette", exact: true })
      .isVisible(),
  );
  await command("window.fullscreen");
  await command("window.minimize");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMinimized(),
    ),
    true,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].restore(),
  );
  results.push({
    name: "different projects, native maximize/minimize, zoom and fullscreen",
  });
  await page
    .getByRole("button", { name: "Choose project color", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Project color hex" })
    .fill("#fa9af4");
  await page.getByRole("button", { name: "Save color", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".color-dialog"));
  await command("markdown.preview");
  await page.locator(".diagram svg").waitFor();
  await page.screenshot({
    path: path.join(workspace, "artifacts/appearance.png"),
  });
  const evidence = { packaged: !!process.env.LWR_PACKAGED, root, results };
  fs.writeFileSync(
    path.join(workspace, "artifacts/appearance-results.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (process.env.LWR_INSPECT === "1") {
    console.log("Window left open for Computer Use.");
    app.on("close", () => process.exit());
    await new Promise(() => {});
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
  });
