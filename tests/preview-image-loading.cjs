const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/image-loading-"));
const root = path.join(base, "workspace").replaceAll("\\", "/");
fs.mkdirSync(root + "/docs/figures", { recursive: true });
fs.copyFileSync(
  path.join(workspace, "assets/icon.png"),
  root + "/docs/figures/chart.png",
);
fs.writeFileSync(root + "/docs/figures/invalid.png", "not a PNG");
fs.writeFileSync(
  root + "/docs/review.md",
  "# Figure loading\n\n![Experiment results](figures/chart.png)\n\n![Missing figure](figures/missing.png)\n\n![Invalid figure](figures/invalid.png)\n",
);
let app, page;
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
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const prototype = require(app.getAppPath() + "/electron/local.cjs")
        .LocalConnection.prototype,
      original = prototype.download;
    globalThis.__imageGates = [];
    prototype.download = async function (args, image, pdf) {
      if (image)
        await new Promise((resolve) => globalThis.__imageGates.push(resolve));
      return original.call(this, args, image, pdf);
    };
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  await page.locator('[data-ready="true"]').waitFor();
  await cmd("file.open", { path: root + "/docs/review.md" });
  await cmd("markdown.preview");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.remote-image[aria-busy="true"]').length === 3,
  );
  assert.equal(
    await page.getByText("Loading image…", { exact: true }).count(),
    3,
  );
  const first = page.locator(".remote-image").first();
  assert.ok(await first.locator(".image-load-state").isVisible());
  assert.ok(
    (await first.locator(".image-load-state").boundingBox()).height >= 72,
  );
  assert.equal(
    await first.locator(".image-caption").innerText(),
    "Experiment results",
  );
  await assert.rejects(
    cmd("preview.image.open", { index: 0 }),
    /image to load/,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await first
      .locator(".image-loading-spinner")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.screenshot({ path: path.join(base, "loading.png") });
  await cmd("preview.find", { search: "Loading image" });
  await page.waitForTimeout(350);
  assert.equal(
    (await cmd("preview.findState")).matches,
    0,
    "status labels are not document content",
  );
  await cmd("preview.closeFind");
  await app.evaluate(() => {
    for (const release of globalThis.__imageGates.splice(0)) release();
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.remote-image[aria-busy="false"]').length ===
      3,
  );
  assert.equal(await first.getAttribute("data-image-ready"), "true");
  assert.equal(
    await first.locator(".image-load-label").textContent(),
    "Rendering image…",
  );
  assert.ok(await first.locator("img").evaluate((el) => el.naturalWidth > 0));
  assert.match(await first.getAttribute("title"), /docs\/figures\/chart.png$/);
  assert.equal(await page.locator(".image-load-state:visible").count(), 0);
  assert.equal(await page.locator(".image-error").count(), 2);
  assert.match(
    await page.locator(".image-error").nth(0).innerText(),
    /Image not found/,
  );
  assert.match(
    await page.locator(".image-error").nth(1).innerText(),
    /could not be decoded/,
  );
  await first.locator(".image-expand").click();
  await page
    .getByRole("dialog", { name: "Expanded image", exact: true })
    .waitFor();
  await cmd("preview.image.close");
  await page.screenshot({ path: path.join(base, "loaded-and-errors.png") });
  console.log(
    JSON.stringify({
      passed: true,
      base,
      checks: [
        "visible pending placeholder",
        "relative paths",
        "loading and rendering phases",
        "busy state clears on success and both failures",
        "reduced motion",
        "loading excluded from Find",
        "expansion after load",
      ],
    }),
  );
})()
  .catch(async (error) => {
    if (page)
      await page
        .screenshot({ path: path.join(base, "failure.png") })
        .catch(() => {});
    console.error(error);
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
