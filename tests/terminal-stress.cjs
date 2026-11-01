const { Connection } = require("../electron/connection.cjs");
const fs = require("node:fs");
const path = require("node:path");
const fixture = require("../artifacts/fixture.json");
const c = new Connection(require("./fixture.cjs").target);
const results = [];
(async () => {
  await c.connect();
  for (let run = 1; run <= 20; run++) {
    const terminal = `stress-${run}`;
    const start = performance.now();
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Shell ${run} did not initialize`)),
        15000,
      );
      const listener = (event) => {
        if (event.terminal === terminal && event.event === "terminal-ready") {
          clearTimeout(timer);
          c.off("remote-event", listener);
          resolve();
        }
      };
      c.on("remote-event", listener);
    });
    const traffic = Promise.all(
      Array.from({ length: 6 }, () =>
        c.request("list", { path: fixture.root }),
      ),
    );
    await c.request("terminal-start", { terminal, path: fixture.root });
    await ready;
    await traffic;
    await c.request("terminal-close", { terminal });
    const ms = Math.round(performance.now() - start);
    results.push({ run, ms, pass: true });
    console.log("Ready", run, ms, "ms");
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    c.close();
    fs.writeFileSync(
      path.join(__dirname, "../artifacts/terminal-stress.json"),
      JSON.stringify({ results, pass: results.length === 20 }, null, 2),
    );
  });
