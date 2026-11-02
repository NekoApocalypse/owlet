// Run against a production build: the original crash does not occur in Vite dev.
const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(
  path.join(workspace, "artifacts/terminal-capabilities-"),
);
const query = "\x1b[4$p\x1b[?2026$p\x1b[?2027$p\x1b[?2031$p";
const replies = [
  "\x1b[4;2$y",
  "\x1b[?2026;2$y",
  "\x1b[?2027;0$y",
  "\x1b[?2031;0$y",
];
const program = path.join(base, "probe.cjs");
fs.writeFileSync(
  program,
  `
process.stdin.setRawMode(true); process.stdin.resume();
let received = '', ready = false;
const timer = setTimeout(() => { console.error('PROTOCOL_TIMEOUT'); process.exit(1); }, 12000);
process.stdin.on('data', chunk => {
 received += chunk.toString();
 if (!ready && ${JSON.stringify(replies)}.every(reply => received.includes(reply))) {
  ready = true; process.stdout.write('\\r\\nCAPABILITIES_OK\\r\\n'); received = '';
 } else if (ready && received.includes('keyboard-ok')) {
  process.stdout.write('\\r\\nKEYBOARD_OK\\r\\n'); clearTimeout(timer); process.stdin.setRawMode(false); process.exit(0);
 }
});
process.stdout.write(${JSON.stringify(query)});
`,
);
const results = [];
let app;
async function check(mode, root, text) {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: mode === "local" ? ["--local", root] : [],
        }
      : {
          args: mode === "local" ? [workspace, "--local", root] : [workspace],
        }),
    env: {
      ...process.env,
      OWLET_USER_DATA: path.join(base, mode + "-profile"),
      ...(mode === "ssh"
        ? { LWR_SSH_TARGET: process.env.OWLET_SSH_TARGET, LWR_ROOT: root }
        : {}),
    },
  });
  try {
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    await page.locator('[data-ready="true"]').waitFor();
    const cmd = (id, args = {}) =>
      page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
        id,
        args,
      });
    await page.waitForFunction(async () => {
      const state = await window.owletCommands.execute("workspace.state", {
        readOnly: true,
      });
      return (
        state.connection === "connected" &&
        state.terminal.sessions[0]?.status === "running" &&
        !!state.terminal.sessions[0]?.pty
      );
    });
    const rendered = page.locator(".terminal-host .xterm-rows");
    await page.waitForTimeout(300);
    const initial = await cmd("workspace.state", { readOnly: true });
    await cmd("terminal.sendText", {
      id: initial.terminal.sessions[0].id,
      text,
    }).catch(async (error) => {
      console.error("Terminal state", initial);
      console.error("Rendered output", await rendered.innerText());
      throw error;
    });
    await rendered.getByText("CAPABILITIES_OK", { exact: true }).waitFor();
    // Input traverses xterm, preload, PTY, and back through the rendered terminal.
    await page.locator(".terminal-host .xterm-helper-textarea").focus();
    await page.keyboard.type("keyboard-ok");
    await rendered.getByText("KEYBOARD_OK", { exact: true }).waitFor();
    await cmd("terminal.sendText", {
      text:
        mode === "local"
          ? "Write-Output ('SHELL_'+'OK')\r"
          : "printf 'SHELL_%s\\n' OK\r",
    });
    await rendered.getByText("SHELL_OK", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.push(
      mode +
        ": ANSI/private/unknown mode replies, keyboard input, and shell recovery",
    );
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close().catch(() => {});
    app = null;
  }
}
(async () => {
  await check(
    "local",
    base,
    `& '${process.execPath.replaceAll("'", "''")}' '${program.replaceAll("'", "''")}'\r`,
  );
  if (process.env.OWLET_SSH_TARGET) {
    const { python } = require("./fixture.cjs");
    const remoteRoot = python(
      'import tempfile; print(tempfile.mkdtemp(prefix="owlet-capabilities-"))',
    );
    const script = `import os,sys,termios,tty,select,time\nold=termios.tcgetattr(0)\ntry:\n tty.setraw(0)\n os.write(1,${JSON.stringify(query)}.encode())\n received=b''; deadline=time.monotonic()+12\n expected=[s.encode() for s in ${JSON.stringify(replies)}]\n while not all(s in received for s in expected):\n  if time.monotonic()>deadline: raise RuntimeError('PROTOCOL_TIMEOUT')\n  if select.select([0],[],[],0.1)[0]: received+=os.read(0,4096)\n os.write(1,b'\\r\\nCAPABILITIES_OK\\r\\n'); received=b''\n while b'keyboard-ok' not in received:\n  if time.monotonic()>deadline: raise RuntimeError('KEYBOARD_TIMEOUT')\n  if select.select([0],[],[],0.1)[0]: received+=os.read(0,4096)\n os.write(1,b'\\r\\nKEYBOARD_OK\\r\\n')\nfinally:\n termios.tcsetattr(0,termios.TCSADRAIN,old)\n`;
    try {
      await check(
        "ssh",
        remoteRoot,
        `python3 -c "import base64;exec(base64.b64decode('${Buffer.from(script).toString("base64")}'))"\r`,
      );
    } finally {
      python(`import os; os.rmdir(${JSON.stringify(remoteRoot)})`);
    }
  }
  fs.writeFileSync(
    path.join(base, "results.json"),
    JSON.stringify({ status: "passed", results }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", base, results }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
