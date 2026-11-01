const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const fixture = require("../artifacts/fixture.json");
const workspace = path.resolve(__dirname, "..");

(async () => {
  const app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
      : { args: [workspace] }),
    env: {
      ...process.env,
      LWR_ROOT: fixture.root,
      LWR_USER_DATA: path.join(workspace, "artifacts/layout-profile"),
    },
  });
  const results = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.locator('[data-ready="true"]').waitFor();
    const command = (id, args) =>
      page.evaluate(({ id, args }) => window.lwrCommands.execute(id, args), {
        id,
        args,
      });
    await command("view.zoom.reset");
    await command("file.open", { path: fixture.root + "/README.md" });
    await page.locator(".diagram svg").waitFor();
    await page.locator(".xterm-screen").waitFor();
    await page.evaluate(() => {
      window.layoutOutput = "";
      window.lwr.onTerminal((event) => {
        if (event.data) window.layoutOutput += atob(event.data);
      });
    });
    async function shell(text, marker) {
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.insertText(text);
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (marker) => window.layoutOutput.includes(marker),
        marker,
      );
    }
    // Fill the viewport so the prompt sits on its last row, exposing clipping.
    await shell(
      "for i in {1..40}; do printf 'Terminal line %s\\n' \"$i\"; done; printf 'LAYOUT_%s\\n' READY",
      "LAYOUT_READY",
    );

    async function check(label) {
      await page.waitForFunction(() => {
        const screen = document
          .querySelector(".xterm-screen")
          .getBoundingClientRect();
        const mount = document
          .querySelector(".terminal-mount")
          .getBoundingClientRect();
        return (
          screen.height > 0 &&
          screen.bottom <= mount.bottom + 1 &&
          screen.right <= mount.right + 1
        );
      });
      const bounds = await page.evaluate(() => {
        const rect = (selector) => {
          const { top, bottom, left, right, width, height } = document
            .querySelector(selector)
            .getBoundingClientRect();
          return { top, bottom, left, right, width, height };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          header: rect(".topbar"),
          footer: rect(".statusbar"),
          screen: rect(".xterm-screen"),
          mount: rect(".terminal-mount"),
          terminal: rect(".terminal-region"),
          editor: rect(".editor-area"),
        };
      });
      assert.ok(
        bounds.screen.bottom <= bounds.footer.top - 5,
        "Last terminal row must clear the status bar",
      );
      assert.ok(bounds.terminal.bottom <= bounds.footer.top + 1);
      assert.ok(bounds.editor.height > 120, "Editor retains useful space");
      assert.ok(Math.abs(bounds.header.height - 32) < 0.1);
      assert.equal(await page.locator(".explorer-footer").count(), 0);
      results.push({ label, ...bounds });
    }
    async function resize(width, height) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.unmaximize();
          win.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.waitForFunction(
        (size) => innerWidth === size.width && innerHeight === size.height,
        { width, height },
      );
    }
    await resize(1366, 768);
    await check("1366x768 default terminal");
    const handle = await page
      .getByRole("separator", { name: "Resize terminal" })
      .boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, 150, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector(".terminal-region").getBoundingClientRect()
          .height > 400,
    );
    await check("expanded terminal");
    await resize(1024, 600);
    await check("shrink window with expanded terminal");
    await command("terminal.toggle");
    await resize(900, 600);
    await command("terminal.toggle");
    await check("show terminal after hidden window resize");
    await command("view.zoom.in");
    await check("zoomed laptop window");
    await command("view.zoom.reset");
    // Verify actual PTY output still reaches the last visible row after resizing.
    await shell("printf 'RESIZE_%s\\n' OK; stty size", "RESIZE_OK");
    await resize(1366, 768);
    const smaller = await page
      .getByRole("separator", { name: "Resize terminal" })
      .boundingBox();
    await page.mouse.move(smaller.x + smaller.width / 2, smaller.y + 2);
    await page.mouse.down();
    await page.mouse.move(smaller.x + smaller.width / 2, 520, { steps: 10 });
    await page.mouse.up();
    await shell(
      "printf '\\033[2J\\033[H'; printf 'SSH terminal ready — input line remains visible.\\n'",
      "SSH terminal ready",
    );
    await check("laptop final");
    await page
      .getByRole("button", { name: "Remote workspace", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Open folder", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.keyboard.press("Control+Shift+P");
    await page
      .getByRole("textbox", { name: "Search commands" })
      .fill("toggle vim");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(workspace, "artifacts/compact-layout.png"),
    });
    fs.writeFileSync(
      path.join(workspace, "artifacts/layout-results.json"),
      JSON.stringify(
        { packaged: !!process.env.LWR_PACKAGED, results },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
    if (process.env.LWR_INSPECT === "1") {
      console.log("Window left open for Computer Use.");
      app.on("close", () => process.exit());
      await new Promise(() => {});
    }
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
