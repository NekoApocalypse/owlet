const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const base = fs.mkdtempSync(path.resolve("artifacts/about-"));
const binary = path.resolve(process.env.LWR_PACKAGED);
const expected = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(binary), "resources/app/package.json"),
  ),
);
let app;
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
(async () => {
  app = await _electron.launch({
    executablePath: binary,
    args: ["--local", base],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  await cmd(page, "terminal.toggle", { visible: false });
  const info = await cmd(page, "help.about", { readOnly: true });
  assert.equal(info.version, expected.version);
  assert.deepEqual(info.build, expected.owletBuild);
  assert.equal(
    await page.getByRole("dialog", { name: "About Owlet" }).count(),
    0,
  );
  await app.evaluate(({ Menu, BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 760);
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = function (template) {
      globalThis.aboutMenu = template;
      const menu = original.call(this, template);
      menu.popup = () => {};
      return menu;
    };
    shell.openExternal = async (url) => {
      globalThis.aboutUrl = url;
    };
  });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await app.evaluate(() =>
    globalThis.aboutMenu.find((item) => item.label === "About Owlet").click(),
  );
  const dialog = page.getByRole("dialog", { name: "About Owlet" });
  await dialog.waitFor();
  assert((await dialog.innerText()).includes(expected.version));
  assert(
    (await dialog.innerText()).includes(expected.owletBuild.commit.slice(0, 7)),
  );
  await page
    .getByRole("button", { name: "Copy version info", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".toast")
      ?.textContent?.includes("Copied version info"),
  );
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert(
    copied.includes("Owlet " + expected.version) &&
      copied.includes(expected.owletBuild.commit),
  );
  assert(
    copied.includes("Electron: ") &&
      copied.includes("Chromium: ") &&
      copied.includes("Node.js: "),
  );
  assert(!copied.includes(base) && !copied.includes("userData"));
  await cmd(page, "message.dismiss");
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  assert.equal(
    await app.evaluate(() => globalThis.aboutUrl),
    "https://github.com/NekoApocalypse/owlet",
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(base, "about.png") });
  await page
    .getByRole("button", { name: "Close About Owlet", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Copy version info",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("aria-label"),
    ),
    "Close About Owlet",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await cmd(page, "commands.show");
  await page.getByRole("textbox", { name: "Search commands" }).fill("about");
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  await page
    .getByRole("button", { name: "Close About Owlet", exact: true })
    .click();
  await cmd(page, "help.copyVersion");
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    copied,
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        base,
        version: info.version,
        build: info.build,
        checks: [
          "File menu and palette share About command",
          "Own package version and immutable build metadata",
          "Copy diagnostics and GitHub link",
          "Keyboard close and focus containment",
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
