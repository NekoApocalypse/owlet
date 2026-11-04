const { _electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const { pdfFixture } = require("./pdf-fixture.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/reader-previews-"));
const root = path.join(base, "Preview workspace").replaceAll("\\", "/");
const png = new (require("@resvg/resvg-js").Resvg)(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" rx="8" fill="#18785a"/></svg>',
)
  .render()
  .asPng();
const files = {
  "readme.md": Buffer.from("# Review\n\nKeep this file focused.\n"),
  "slow.pdf": pdfFixture(),
  "slow.png": png,
  "slow.txt": Buffer.from("Loaded text"),
  "close.pdf": pdfFixture(),
  "retry.txt": Buffer.from("Recovered"),
  "index.html": Buffer.from(
    `<!doctype html><html><head><title>Review</title><link rel="stylesheet" href="styles/main.css"></head><body><h1 id="proof">HTML review</h1><p>Static files, over local or SSH.</p><img id="picture" src="assets/own%20image.png"><img id="vector" src="/assets/vector.svg"><div class="tile">Styled asset</div><script>window.compromised=true;fetch('https://example.invalid/script')</script><iframe src="https://example.invalid/frame"></iframe><img id="blocked" src="https://example.invalid/image" onerror="window.compromised=true"><a id="link" href="https://example.invalid/nav">External link</a><form action="https://example.invalid/form"><button>Submit</button></form></body></html>`,
  ),
  "styles/main.css": Buffer.from(
    '@import "nested/type.css"; h1 { color: rgb(25,120,90); } .tile {background-image:url("../assets/vector.svg");width:160px;height:64px}',
  ),
  "styles/nested/type.css": Buffer.from(
    "body {font-family: sans-serif; padding:24px;} h1 {font-size:30px}",
  ),
  "assets/own image.png": png,
  "assets/vector.svg": Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="orange"/></svg>',
  ),
  "paper.tex": Buffer.from(
    "\\documentclass{article}\n% a comment\n\\begin{document}\n\\section{Result}\n$E = mc^2$\n\\end{document}\n",
  ),
  "refs.bib": Buffer.from(
    '@article{smith2026,\n  title = {A useful result},\n  year = 2026,\n  author = "Smith"\n}\n% bibliography comment\n',
  ),
  "style.sty": Buffer.from(
    "\\ProvidesPackage{example}\n\\newcommand{\\answer}{42}\n% style comment\n",
  ),
  "style.bst": Buffer.from(
    'ENTRY { author title } {} {}\nFUNCTION {example} { "hello" write$ }\n% style comment\n',
  ),
};
for (const [name, bytes] of Object.entries(files)) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
const cmd = (page, id, args = {}) =>
  page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
    id,
    args,
  });
let app, remoteRoot;
async function until(page, fn, arg) {
  const start = Date.now();
  while (!(await page.evaluate(fn, arg))) {
    if (Date.now() - start > 30000) throw Error("Timed out waiting for state");
    await page.waitForTimeout(50);
  }
}
async function gate(file, hold) {
  await app.evaluate(
    (_, { file, hold }) => {
      if (hold) globalThis.readHolds.add(file);
      else {
        globalThis.readHolds.delete(file);
        for (const resolve of globalThis.readWaiters.get(file) || []) resolve();
        globalThis.readWaiters.delete(file);
      }
    },
    { file, hold },
  );
}
async function startOpen(page, file) {
  await page.evaluate((file) => {
    window.testOpen = window.owletCommands.execute("file.open", { path: file });
  }, file);
}
async function loading(page, file, type) {
  await gate(file, true);
  const started = Date.now();
  await startOpen(page, file);
  await page
    .locator('.file-load-state[role="status"]')
    .waitFor({ timeout: 1500 });
  assert(
    Date.now() - started < 1500,
    "Tab and loading view must not wait for transfer",
  );
  assert.equal(
    await page.locator(".tab.active-tab").innerText(),
    path.basename(file),
  );
  await page.waitForFunction(
    (file) =>
      document
        .querySelector(".tree-row.selected")
        ?.getAttribute("data-file-path") === file,
    file,
  );
  assert((await cmd(page, "file.inspect", { readOnly: true })).loading);
  assert.match(
    await page.locator(".file-load-state span").innerText(),
    /Loading .+…/,
  );
  await assert.rejects(
    cmd(page, "editor.setText", { text: "Do not edit placeholders" }),
    /unavailable|text file/,
  );
  if (type === "PDF" && file.startsWith(root + "/")) {
    // State assertions above are immediate; let the compositor finish painting
    // text before capturing review evidence (the read remains gated).
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(base, "loading.png"),
      animations: "disabled",
    });
  }
  // A later user action wins even when this transfer completes afterwards.
  await cmd(page, "file.open", {
    path: file.slice(0, file.lastIndexOf("/")) + "/readme.md",
  });
  await gate(file, false);
  await page.evaluate(() => window.testOpen);
  assert.match(await page.locator(".tab.active-tab").innerText(), /readme.md/);
  await cmd(page, "file.open", { path: file });
  if (type === "PDF")
    await page.locator('.pdf-viewer[data-rendered="true"]').waitFor();
  if (type === "Image") await page.locator(".image-viewer img").waitFor();
  assert.equal(
    await page
      .locator(".tab.active-tab [data-file-kind]")
      .getAttribute("data-file-kind"),
    type,
  );
}
async function html(page, workspace) {
  await cmd(page, "file.open", { path: workspace + "/index.html" });
  const frame = page.frameLocator('iframe[title="HTML preview: index.html"]');
  await frame.locator("#proof").waitFor();
  assert.equal(
    await frame.locator("#proof").evaluate((el) => getComputedStyle(el).color),
    "rgb(25, 120, 90)",
  );
  assert.equal(
    await frame
      .locator("#proof")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "30px",
  );
  await until(page, () => {
    const f = document.querySelector(".html-preview iframe");
    return !!f?.getAttribute("srcdoc")?.includes("data:image/png");
  });
  assert(
    await frame
      .locator("#picture")
      .evaluate((el) => el.complete && el.naturalWidth > 0),
  );
  assert(
    await frame
      .locator("#vector")
      .evaluate((el) => el.complete && el.naturalWidth === 16),
  );
  assert.match(
    await frame
      .locator(".tile")
      .evaluate((el) => getComputedStyle(el).backgroundImage),
    /data:image\/svg/,
  );
  assert.equal(await frame.locator("script,iframe,link").count(), 0);
  assert.equal(await frame.locator("#link").getAttribute("href"), null);
  assert.equal(await frame.locator("#blocked").getAttribute("src"), null);
  assert.deepEqual(
    await frame.locator("body").evaluate(() => ({
      api: typeof window.lwr,
      script: typeof window.compromised,
      origin: location.origin,
    })),
    { api: "undefined", script: "undefined", origin: "null" },
  );
  const sandbox = await page
    .locator(".html-preview iframe")
    .getAttribute("sandbox");
  assert.equal(sandbox, "");
  if (workspace === root)
    await page.screenshot({ path: path.join(base, "html.png") });
  await page
    .getByRole("button", { name: "Source and preview", exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  await frame.locator("#proof").waitFor();
  await cmd(page, "editor.setText", {
    text: '<h1 id="edited">Unsaved HTML</h1>',
  });
  await frame.locator("#edited").waitFor();
  assert((await cmd(page, "file.inspect", { readOnly: true })).dirty);
  await cmd(page, "html.source");
  assert.equal(await page.locator(".html-preview").count(), 0);
  await cmd(page, "html.preview");
  await frame.locator("#edited").waitFor();
  await cmd(page, "html.refresh");
  await frame.locator("#edited").waitFor();
}
(async () => {
  app = await _electron.launch({
    executablePath: path.resolve(process.env.LWR_PACKAGED),
    args: ["--local", root],
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-ready="true"]').waitFor();
  await app.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 760);
    const require = process.mainModule.require.bind(process.mainModule),
      path = require("path");
    globalThis.readHolds = new Set();
    globalThis.readWaiters = new Map();
    globalThis.readCounts = new Map();
    for (const [file, name] of [
      ["local.cjs", "LocalConnection"],
      ["connection.cjs", "Connection"],
    ]) {
      const cls = require(path.join(app.getAppPath(), "electron", file))[name],
        original = cls.prototype.download;
      cls.prototype.download = async function (args, ...rest) {
        globalThis.readCounts.set(
          args.path,
          (globalThis.readCounts.get(args.path) || 0) + 1,
        );
        if (globalThis.readHolds.has(args.path))
          await new Promise((resolve) => {
            const waiters = globalThis.readWaiters.get(args.path) || [];
            waiters.push(resolve);
            globalThis.readWaiters.set(args.path, waiters);
          });
        return original.call(this, args, ...rest);
      };
    }
  });
  const network = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await cmd(page, "terminal.toggle", { visible: false });
  for (const [file, type] of [
    ["slow.pdf", "PDF"],
    ["slow.png", "Image"],
    ["slow.txt", "Text"],
  ])
    await loading(page, root + "/" + file, type);
  await gate(root + "/close.pdf", true);
  await startOpen(page, root + "/close.pdf");
  await page.locator(".file-load-state").waitFor();
  await cmd(page, "file.close");
  await gate(root + "/close.pdf", false);
  await page.evaluate(() => window.testOpen);
  assert.equal(
    await page.getByRole("tab", { name: /close.pdf/ }).count(),
    0,
    "Closing a pending read cannot resurrect its tab",
  );
  await cmd(page, "file.open", { path: root + "/missing.txt" });
  await page.getByRole("heading", { name: "Could not load file" }).waitFor();
  fs.writeFileSync(root + "/missing.txt", "Recovered from missing file");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  assert.equal(
    (await cmd(page, "file.inspect", { readOnly: true })).text,
    "Recovered from missing file",
  );
  await cmd(page, "message.dismiss");
  await html(page, root);
  for (const name of ["paper.tex", "refs.bib", "style.sty", "style.bst"]) {
    await cmd(page, "file.open", { path: root + "/" + name });
    await page.locator(".cm-content").waitFor();
    const tokens = await page
      .locator(".cm-line span")
      .evaluateAll((els) =>
        els
          .filter(
            (e) =>
              getComputedStyle(e).color !==
              getComputedStyle(e.parentElement).color,
          )
          .map((e) => e.textContent),
      );
    assert(
      tokens.length >= 3,
      name + " needs highlighted content: " + tokens.join(","),
    );
    if (name === "paper.tex")
      await page.screenshot({ path: path.join(base, "latex.png") });
    if (name === "refs.bib")
      assert(
        tokens.some((t) => t.includes("title")) &&
          tokens.some((t) => t.includes("@article")),
      );
  }
  if (process.env.OWLET_SSH_TARGET) {
    const { python, target } = require("./fixture.cjs");
    const payload = Buffer.from(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(files).map(([name, data]) => [
            name,
            data.toString("base64"),
          ]),
        ),
      ),
    ).toString("base64");
    remoteRoot = python(
      `import pathlib,tempfile,base64,json\np=pathlib.Path(tempfile.mkdtemp(prefix='owlet-reader-'))\nfor name,data in json.loads(base64.b64decode('${payload}')).items():\n f=p/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(base64.b64decode(data))\nprint(p)`,
    );
    const opened = app.waitForEvent("window");
    await cmd(page, "workspace.openSSH", { target, path: remoteRoot });
    const remote = await opened;
    await remote.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
    await cmd(remote, "terminal.toggle", { visible: false });
    remote.on("request", (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    await loading(remote, remoteRoot + "/slow.pdf", "PDF");
    await html(remote, remoteRoot);
    if (process.env.OWLET_SSH_PDF) {
      const requested = process.env.OWLET_SSH_PDF;
      const workspace = process.env.OWLET_SSH_WORKSPACE;
      const opened = app.waitForEvent("window");
      await cmd(page, "workspace.openSSH", { target, path: workspace });
      const real = await opened;
      await real.locator('[data-ready="true"]').waitFor({ timeout: 40000 });
      await startOpen(real, requested);
      await real.locator(".file-load-state").waitFor({ timeout: 2000 });
      await real
        .getByRole("tab", {
          name: new RegExp(
            path.posix
              .basename(requested)
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        })
        .waitFor();
      await real.evaluate(() => window.testOpen);
      await real
        .locator('.pdf-viewer[data-rendered="true"]')
        .waitFor({ timeout: 120000 });
      console.log("Reported SSH PDF opened and rendered successfully.");
    }
  }
  assert.deepEqual(network, [], "Static HTML cannot make network requests");
  console.log(
    JSON.stringify(
      {
        passed: true,
        base,
        ssh: !!process.env.OWLET_SSH_TARGET,
        checks: [
          "Immediate tab/Explorer/loading",
          "Late completion preserves focus and closed tabs",
          "Retry after load failure",
          "Distinct file types",
          "Static HTML CSS/import/image assets and sandbox",
          "HTML UI/API modes and unsaved preview",
          "LaTeX/BibTeX highlighting",
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
    if (remoteRoot && /^\/tmp\/owlet-reader-[\w-]+$/.test(remoteRoot))
      require("./fixture.cjs").python(
        `import shutil;shutil.rmtree(${JSON.stringify(remoteRoot)})`,
      );
  });
