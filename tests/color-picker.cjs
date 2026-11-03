const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = fs.mkdtempSync(path.resolve("artifacts/color-picker-"));
const root = path.join(base, "project"),
  config = path.join(root, ".owlet/settings.json");
fs.mkdirSync(path.dirname(config), { recursive: true });
fs.writeFileSync(
  config,
  JSON.stringify({ "peacock.color": "#355c7d", keep: true }),
);
fs.writeFileSync(
  path.join(root, "README.md"),
  "# Project notes\n\nA focused workspace.\n",
);
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
let app;
async function launch() {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", root],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 760),
  );
  await cmd(page, "view.zoom.reset");
  return page;
}
async function close() {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch((error) => {
        if (!/closed/.test(error.message)) throw error;
      });
    await app.close().catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    app = null;
  }
}
async function bars(page, expected) {
  await page.waitForFunction(
    (expected) =>
      [".topbar", ".statusbar"].every(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundColor ===
          expected,
      ),
    expected,
  );
}
(async () => {
  let page = await launch();
  await cmd(page, "terminal.toggle", { visible: false });
  await cmd(page, "file.open", {
    path: path.join(root, "README.md").replaceAll("\\", "/"),
  });
  await cmd(page, "markdown.preview");
  await page
    .getByRole("button", { name: "Choose project color", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Project window color" });
  await dialog.waitFor();
  assert.equal(await dialog.locator(".color-swatches button").count(), 8);
  const original = fs.readFileSync(config, "utf8");
  const hex = page.getByRole("textbox", { name: "Project color hex" });
  const h = page.getByRole("spinbutton", { name: "Hue", exact: true });
  const s = page.getByRole("spinbutton", { name: "Saturation", exact: true });
  const b = page.getByRole("spinbutton", { name: "Brightness", exact: true });
  await hex.fill("#ff0000");
  assert.equal(await h.inputValue(), "0");
  assert.equal(await s.inputValue(), "100");
  assert.equal(await b.inputValue(), "100");
  await bars(page, "rgb(255, 0, 0)");
  await h.fill("120");
  assert.equal(await hex.inputValue(), "#00ff00");
  await bars(page, "rgb(0, 255, 0)");
  await s.fill("50");
  await b.fill("80");
  assert.equal(await hex.inputValue(), "#66cc66");
  await hex.fill("#000000");
  assert.equal(await h.inputValue(), "120", "Black preserves hue");
  assert.equal(await s.inputValue(), "50", "Black preserves saturation");
  await b.fill("80");
  assert.equal(await hex.inputValue(), "#66cc66");
  await hex.fill("#808080");
  assert.equal(await h.inputValue(), "120", "Gray preserves hue");
  await s.fill("100");
  assert.equal(await hex.inputValue(), "#008000");
  await hex.fill("336699");
  assert.equal(await hex.inputValue(), "#336699");
  await hex.fill("#12");
  assert.equal(await hex.getAttribute("aria-invalid"), "true");
  assert(
    await page
      .getByRole("button", { name: "Save color", exact: true })
      .isDisabled(),
  );
  await bars(page, "rgb(51, 102, 153)");
  assert.equal(
    fs.readFileSync(config, "utf8"),
    original,
    "Drafts never write settings",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await bars(page, "rgb(53, 92, 125)");
  await cmd(page, "project.color.set");
  await hex.fill("#ff0000");
  const plane = page.getByRole("group", {
    name: "Saturation and brightness",
    exact: true,
  });
  const box = await plane.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert(Math.abs(Number(await s.inputValue()) - 50) <= 1);
  assert(Math.abs(Number(await b.inputValue()) - 50) <= 1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  assert(Math.abs(Number(await s.inputValue()) - 51) <= 1);
  assert(Math.abs(Number(await b.inputValue()) - 60) <= 1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, box.y - 20);
  await page.mouse.up();
  assert.equal(await s.inputValue(), "100");
  assert.equal(await b.inputValue(), "100");
  const hue = page.getByRole("slider", { name: "Hue slider" });
  await hue.focus();
  await page.keyboard.press("End");
  assert.equal(await h.inputValue(), "360");
  assert.equal(await hex.inputValue(), "#ff0000");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  assert.equal(await h.inputValue(), "1");
  await page
    .getByRole("button", { name: "Choose #6b487d", exact: true })
    .click();
  assert.equal(await hex.inputValue(), "#6b487d");
  await bars(page, "rgb(107, 72, 125)");
  assert(
    await dialog.locator(".color-channels").evaluate((el) =>
      [...el.querySelectorAll("label")].every((label) => {
        const outer = label.getBoundingClientRect();
        return [...label.children].every((child) => {
          const inner = child.getBoundingClientRect();
          return (
            inner.top >= outer.top &&
            inner.bottom <= outer.bottom &&
            inner.right <= outer.right
          );
        });
      }),
    ),
    "HSB fields must fit within their compact rows",
  );
  await page.screenshot({ path: path.join(base, "picker.png") });
  // Tab traversal stays inside the dialog.
  await plane.focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Save color",
  );
  await page.keyboard.press("Tab");
  assert(await plane.evaluate((e) => e === document.activeElement));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await bars(page, "rgb(53, 92, 125)");
  assert.equal(fs.readFileSync(config, "utf8"), original);
  await cmd(page, "project.color.set");
  await hex.fill("#ffffff");
  await bars(page, "rgb(255, 255, 255)");
  assert.equal(
    await page.locator(".statusbar").evaluate((e) => getComputedStyle(e).color),
    "rgb(16, 24, 40)",
  );
  await page.getByRole("button", { name: "Save color", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(JSON.parse(fs.readFileSync(config, "utf8")), {
    "peacock.color": "#ffffff",
    keep: true,
  });
  // The API and UI share the same validation and revision conflict protection.
  await cmd(page, "project.color.set", { color: "#445b8a" });
  await cmd(page, "project.color.set");
  assert.equal(await hex.inputValue(), "#445b8a");
  await hex.fill("#123456");
  fs.writeFileSync(
    config,
    JSON.stringify({ "peacock.color": "#376b62", keep: true }),
  );
  await page.getByRole("button", { name: "Save color", exact: true }).click();
  await page
    .getByText(/CONFLICT/)
    .first()
    .waitFor();
  assert(await dialog.isVisible());
  assert.equal(
    JSON.parse(fs.readFileSync(config, "utf8"))["peacock.color"],
    "#376b62",
  );
  await cmd(page, "project.settings.reload");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await bars(page, "rgb(55, 107, 98)");
  await assert.rejects(
    cmd(page, "project.color.set", { color: "red" }),
    /six-digit/,
  );
  await close();
  page = await launch();
  await bars(page, "rgb(55, 107, 98)");
  await cmd(page, "project.color.set");
  assert.equal(
    await page.getByRole("textbox", { name: "Project color hex" }).inputValue(),
    "#376b62",
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        screenshot: path.join(base, "picker.png"),
        coverage: [
          "HSB/HEX synchronization",
          "pointer capture and keyboard controls",
          "unchanged palette",
          "live contrast and cancellation",
          "save and restart persistence",
          "conflict protection",
          "UI/API equivalence",
        ],
      },
      null,
      2,
    ),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(close);
