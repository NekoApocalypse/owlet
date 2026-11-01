const { spawn } = require("node:child_process");
const path = require("node:path");
const vite = spawn(
  process.execPath,
  [path.join(__dirname, "../node_modules/vite/bin/vite.js")],
  { stdio: "inherit" },
);
let desktop;
const timer = setInterval(async () => {
  try {
    const r = await fetch("http://127.0.0.1:5173");
    if (!r.ok || desktop) return;
    clearInterval(timer);
    desktop = spawn(require("electron"), ["."], {
      stdio: "inherit",
      env: { ...process.env, LWR_DEV_URL: "http://127.0.0.1:5173" },
    });
    desktop.on("exit", () => {
      vite.kill();
      process.exit();
    });
  } catch {}
}, 300);
process.on("SIGINT", () => {
  clearInterval(timer);
  desktop?.kill();
  vite.kill();
  process.exit();
});
