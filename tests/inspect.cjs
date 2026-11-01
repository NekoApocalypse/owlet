const { _electron } = require("playwright");
const path = require("node:path");
const fixture = require("../artifacts/fixture.json");
const fs = require("node:fs");
(async () => {
  const started = performance.now();
  const app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
      : { args: [path.join(__dirname, "..")] }),
    env: {
      ...process.env,
      LWR_ROOT: fixture.root,
      LWR_USER_DATA: path.join(__dirname, "../artifacts/inspect-profile"),
    },
  });
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      console.log(message.type(), message.text());
  });
  page.on("pageerror", (error) => console.log("PAGE ERROR", error));
  await page.locator('[data-ready="true"]').waitFor();
  const readyMs = Math.round(performance.now() - started);
  await page.evaluate(
    (root) =>
      window.lwrCommands.execute("file.open", { path: root + "/README.md" }),
    fixture.root,
  );
  await page.locator(".diagram svg").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".diagram svg")?.textContent.includes("Your agents"),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".markdown-preview img")].some(
      (img) => img.naturalWidth > 0,
    ),
  );
  const proof = {
    packaged: !!process.env.LWR_PACKAGED,
    readyMs,
    math: await page.locator(".katex").count(),
    diagrams: await page.locator(".diagram svg").count(),
    diagramLabels: await page.locator(".diagram svg text").allTextContents(),
    commands: await page.evaluate(() => window.lwrCommands.list().length),
  };
  console.log(proof);
  fs.writeFileSync(
    path.join(__dirname, "../artifacts/package-smoke.json"),
    JSON.stringify(proof, null, 2),
  );
  await page.screenshot({
    path: path.join(__dirname, "../artifacts/packaged-proof.png"),
  });
  await page.locator(".diagram").screenshot({
    path: path.join(__dirname, "../artifacts/packaged-mermaid-proof.png"),
  });
  console.log("Window left open for computer-use verification.");
  app.on("close", () => process.exit());
  setInterval(() => {}, 1000);
})();
