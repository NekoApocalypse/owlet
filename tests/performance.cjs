const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const workspace = path.join(__dirname, "..");
const fixture = require("../artifacts/fixture.json");
if (
  path.posix.dirname(fixture.root) !== require("./fixture.cjs").temporaryRoot ||
  !/^lwr-acceptance-[a-z0-9_]+$/.test(path.posix.basename(fixture.root))
)
  throw new Error("Unexpected test fixture directory");
require("./fixture.cjs").python(
  `p=${JSON.stringify(fixture.root + "/large.md")}\nwith open(p,'rb') as f:data=f.read(32768)\nwith open(p,'wb') as f:f.write(data.ljust(32768,b' '))`,
);
const results = [];
const profiles = process.env.LWR_PERF_PROFILE
  ? [process.env.LWR_PERF_PROFILE]
  : ["actual-vpn", "shaped-vpn"];
const runs = Number(process.env.LWR_PERF_RUNS || 5);
const ready = (page) =>
  page
    .locator('[data-testid="explorer-tree"][data-ready="true"]')
    .waitFor({ timeout: 30000 });
async function metrics(app) {
  return app.evaluate(async ({ app }) => {
    const control = globalThis.__lwrMetrics?.() || {};
    return {
      ...control,
      memoryKiB: app
        .getAppMetrics()
        .reduce((sum, item) => sum + item.memory.workingSetSize, 0),
    };
  });
}
(async () => {
  for (const profile of profiles)
    for (let run = 1; run <= runs; run++) {
      const proxy =
        profile === "shaped-vpn"
          ? `"${process.execPath}" "${path.join(__dirname, "throttle-proxy.cjs")}" %h %p`
          : "";
      const env = {
        ...process.env,
        LWR_ROOT: fixture.root,
        LWR_USER_DATA: path.join(workspace, "artifacts/perf-profile"),
        LWR_SSH_PROXY: proxy,
        LWR_PROXY_METRICS: path.join(
          workspace,
          `artifacts/wire-${profile}-${run}.json`,
        ),
        LWR_TEST_METRICS: "1",
      };
      const start = performance.now();
      const app = await electron.launch({
        ...(process.env.LWR_PACKAGED
          ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
          : { args: [workspace] }),
        env,
        timeout: 40000,
      });
      try {
        const page = await app.firstWindow();
        await ready(page);
        const coldMs = performance.now() - start;
        console.log(profile, run, "cold listing", Math.round(coldMs), "ms");
        const cold = await metrics(app);
        // Start a real image transfer; opening another project must not wait for its completion.
        await page.evaluate((root) => {
          window.__bulk = window.lwr
            .remote("image", { path: root + "/images/bulk.png" })
            .catch((error) => ({ error: String(error) }));
        }, fixture.root);
        await page.waitForTimeout(200);
        // Use the same remote launcher as users do, through the integrated terminal.
        await page.evaluate(() => window.lwrCommands.execute("terminal.focus"));
        await page.waitForTimeout(600);
        const warmBefore = await metrics(app),
          warmStart = performance.now();
        const opened = app.waitForEvent("window", { timeout: 30000 });
        await page.keyboard.type("lwr .");
        await page.keyboard.press("Enter");
        const second = await opened;
        await ready(second);
        const warmMs = performance.now() - warmStart,
          warmAfter = await metrics(app);
        console.log(profile, run, "warm listing", Math.round(warmMs), "ms");
        const fileStart = performance.now();
        const fileWindow = app.waitForEvent("window", { timeout: 30000 });
        await page.bringToFront();
        await page.evaluate(() => window.lwrCommands.execute("terminal.focus"));
        await page.locator(".xterm-helper-textarea").focus();
        await page.keyboard.type("lwr large.md");
        await page.keyboard.press("Enter");
        const third = await fileWindow;
        await ready(third);
        await third.waitForFunction(() =>
          document
            .querySelector('[role="tab"]')
            ?.getAttribute("title")
            ?.endsWith("/large.md"),
        );
        await third.evaluate(() =>
          window.lwrCommands.execute("markdown.source"),
        );
        await third.locator(".cm-content").waitFor();
        const fileMs = performance.now() - fileStart;
        const coldControlBytes =
          cold.bootstrap + cold.controlSent + cold.controlReceived;
        const warmControlBytes =
          warmAfter.controlSent +
          warmAfter.controlReceived -
          warmBefore.controlSent -
          warmBefore.controlReceived;
        const result = {
          profile,
          run,
          coldMs: Math.round(coldMs),
          warmMs: Math.round(warmMs),
          fileMs: Math.round(fileMs),
          bootstrapBytes: cold.bootstrap,
          coldControlBytes,
          warmControlBytes,
          coldSent: cold.sent,
          coldReceived: cold.received,
          warmSent: warmAfter.sent - warmBefore.sent,
          warmReceived: warmAfter.received - warmBefore.received,
          idleMemoryKiB: cold.memoryKiB,
          pass:
            coldMs < 10000 &&
            warmMs < 10000 &&
            fileMs < 10000 &&
            coldControlBytes <= 32768 &&
            warmControlBytes <= 4096,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        for (const [index, window] of app.windows().entries()) {
          await window
            .screenshot({
              path: path.join(workspace, `artifacts/perf-failure-${index}.png`),
            })
            .catch(() => {});
          console.error(
            "WINDOW",
            index,
            await window.locator("body").innerText().catch(String),
          );
        }
        throw error;
      } finally {
        await app.close();
      }
      fs.writeFileSync(
        path.join(workspace, "artifacts/performance.json"),
        JSON.stringify(
          {
            packaged: !!process.env.LWR_PACKAGED,
            note: "Shaped profile uses 256 kbit/s each direction and ADDS 250 ms RTT to the actual VPN; all data goes to the real server. Warm and file windows launch during image transfer. Timings include Playwright input/control overhead.",
            results,
          },
          null,
          2,
        ),
      );
    }
  if (results.some((result) => !result.pass)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
