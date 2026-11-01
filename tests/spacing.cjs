const { _electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", path.join(root, "examples/agent-review")],
        }
      : { args: [root, "--local", path.join(root, "examples/agent-review")] }),
    env: {
      ...process.env,
      OWLET_USER_DATA: path.join(root, "artifacts/spacing-profile"),
    },
  });
  try {
    const page = await app.firstWindow();
    const stage = process.env.OWLET_SPACING_STAGE || "after";
    await page.locator('[data-ready="true"]').waitFor();
    const command = (id, args = {}) =>
      page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
        id,
        args,
      });
    await command("file.open", {
      path: path
        .join(root, "examples/agent-review/REVIEW.md")
        .replaceAll("\\", "/"),
    });
    await page.locator(".diagram svg").waitFor();
    const measurements = [];
    for (const [width, height] of [
      [1366, 768],
      [1024, 600],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setContentSize(...size),
        [width, height],
      );
      await command("commands.show");
      await page.getByRole("textbox", { name: "Search commands" }).waitFor();
      const metrics = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            height: r.height,
            width: r.width,
          };
        };
        return {
          row: box(".tree-row"),
          tab: box(".tabs-bar"),
          toolbar: box(".document-toolbar"),
          paletteRow: box(".command-option"),
          palette: box(".command-palette"),
          terminal: box(".xterm-screen"),
          mount: box(".terminal-mount"),
          footer: box(".statusbar"),
          viewport: innerHeight,
        };
      });
      measurements.push({ width, height, ...metrics });
      if (stage === "after") {
        assert.ok(Math.abs(metrics.row.height - 22) < 1);
        assert.ok(Math.abs(metrics.paletteRow.height - 28) < 1);
        assert.ok(metrics.palette.bottom <= height);
        assert.ok(metrics.terminal.bottom <= metrics.mount.bottom + 1);
        assert.ok(metrics.terminal.bottom <= metrics.footer.top + 1);
      }
      await page.screenshot({
        path: path.join(root, `artifacts/spacing-${stage}-${width}.png`),
      });
      await page.keyboard.press("Escape");
    }
    fs.writeFileSync(
      path.join(root, `artifacts/spacing-${stage}.json`),
      JSON.stringify(measurements, null, 2),
    );
    console.log(JSON.stringify(measurements, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
