const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(path.join(workspace, "artifacts/expanded-images-"));
const remote = !!process.env.OWLET_SSH_TARGET;
const fixture = remote ? require("./fixture.cjs") : null;
const root = remote
  ? fixture.python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-images-"))',
    )
  : path.join(base, "workspace").replaceAll("\\", "/");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="1800"><rect width="3000" height="1800" fill="#182943"/><circle cx="650" cy="850" r="380" fill="#87a9d6"/><path d="M1100 850H1900" stroke="#ffb53d" stroke-width="30"/><rect x="1950" y="470" width="650" height="760" rx="30" fill="#e5edf7"/><text x="1500" y="220" fill="white" font-size="90" text-anchor="middle">Agent output · Inspect the details</text></svg>';
const png = new Resvg(svg).render().asPng();
const markdown =
  "# Image review\n\n![Architecture](media/chart.png)\n\n[![Linked illustration](media/linked.png)](other.md)\n\n![Missing](missing.png)\n\n```mermaid\nflowchart LR\nA[Agent]-->B[Review]\n```\n";
const files = {
  "review.md": Buffer.from(markdown),
  "other.md": Buffer.from("# Linked document"),
  "media/chart.png": png,
  "media/linked.png": png,
};
if (remote) {
  const encoded = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      bytes.toString("base64"),
    ]),
  );
  const setup = `import os,base64,json,sys\nr=${JSON.stringify(root)}\nfor name,data in json.load(sys.stdin).items():\n p=os.path.join(r,name);os.makedirs(os.path.dirname(p),exist_ok=True);open(p,'wb').write(base64.b64decode(data))`;
  const script = Buffer.from(setup).toString("base64");
  require("node:child_process").execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      fixture.target,
      `python3 -c "import base64;exec(base64.b64decode('${script}'))"`,
    ],
    { input: JSON.stringify(encoded), timeout: 30000, windowsHide: true },
  );
} else {
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(root + "/" + name), { recursive: true });
    fs.writeFileSync(root + "/" + name, bytes);
  }
}
let app;
async function until(fn) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 30000) throw Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: remote ? [] : ["--local", root],
        }
      : { args: [workspace, ...(remote ? [] : ["--local", root])] }),
    env: {
      ...process.env,
      OWLET_USER_DATA: path.join(base, "profile"),
      ...(remote ? { LWR_SSH_TARGET: fixture.target, LWR_ROOT: root } : {}),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  const state = () => cmd("workspace.state", { readOnly: true });
  const imageState = async () => (await state()).expandedImage;
  await page.locator('[data-ready="true"]').waitFor();
  await cmd("file.open", { path: root + "/review.md" });
  await cmd("markdown.preview");
  await page
    .getByRole("button", { name: "Expand image 1", exact: true })
    .waitFor();
  await until(
    async () =>
      await page
        .getByRole("button", { name: "Expand image 2", exact: true })
        .isEnabled(),
  );
  await page.locator(".image-error").waitFor();
  await assert.rejects(
    cmd("preview.image.open", { index: 2 }),
    /image to load/,
  );
  await assert.rejects(cmd("preview.image.open", { index: -1 }), /valid image/);
  await cmd("preview.zoom.in");
  const previewZoomBefore = (await state()).previewZoom;
  await app.evaluate(({ app }, remote) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const mod = require(
      app.getAppPath() +
        "/electron/" +
        (remote ? "connection.cjs" : "local.cjs"),
    );
    const prototype = (mod.Connection || mod.LocalConnection).prototype;
    const original = prototype.download;
    globalThis.__imageReads = 0;
    prototype.download = function (args, image, pdf) {
      if (image) globalThis.__imageReads++;
      return original.call(this, args, image, pdf);
    };
  }, remote);
  const expand = page.getByRole("button", {
    name: "Expand image 1",
    exact: true,
  });
  await expand.click();
  const dialog = page.getByRole("dialog", {
    name: "Expanded image",
    exact: true,
  });
  await dialog.waitFor();
  await until(async () => (await imageState())?.scale < 1);
  let value = await imageState();
  assert.equal(value.width, 3000);
  assert.equal(value.height, 1800);
  assert.equal((await state()).diagram, null);
  const fitted = value.scale;
  await page
    .getByRole("button", { name: "Zoom image in", exact: true })
    .click();
  assert.ok((await imageState()).scale > fitted);
  const canvas = page.locator(".diagram-canvas"),
    box = await canvas.boundingBox();
  value = await imageState();
  await page.mouse.move(box.x + 250, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 250, { steps: 5 });
  await page.mouse.up();
  assert.ok((await imageState()).x > value.x + 60);
  value = await imageState();
  await page.mouse.wheel(0, -250);
  await until(async () => (await imageState()).scale > value.scale);
  await cmd("preview.image.actualSize");
  assert.equal((await imageState()).scale, 1);
  value = await imageState();
  await cmd("preview.image.zoom", { factor: 2, x: 120, y: 80 });
  assert.equal((await imageState()).x, 120 - (120 - value.x) * 2);
  await cmd("preview.image.zoom", { scale: 100 });
  assert.equal((await imageState()).scale, 16);
  await assert.rejects(cmd("preview.image.pan", { dx: "bad" }), /numeric/);
  await assert.rejects(cmd("diagram.zoom", { scale: 2 }), /available|enabled/);
  await canvas.focus();
  await page.keyboard.press("Control+0");
  await until(
    async () => Math.abs((await imageState()).scale - fitted) < 0.001,
  );
  assert.equal((await state()).previewZoom, previewZoomBefore);
  await page.keyboard.press("1");
  assert.equal((await imageState()).scale, 1);
  await page.keyboard.press("ArrowRight");
  assert.ok((await imageState()).x < value.x);
  await cmd("preview.image.fit");
  await page.screenshot({ path: path.join(base, "expanded-image.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await expand.evaluate((el) => document.activeElement === el));
  await page.locator(".remote-image img").first().click();
  await dialog.waitFor();
  await page.keyboard.press("Control+Shift+P");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Preview Image: Close Expanded View");
  await page.getByRole("option").first().click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await app.evaluate(() => globalThis.__imageReads),
    0,
    "expansion must not reread images",
  );
  await page
    .getByRole("button", { name: "Expand image 2", exact: true })
    .click();
  await dialog.waitFor();
  assert.equal((await imageState()).width, 3000);
  await cmd("preview.image.close");
  await page.locator(".remote-image img").nth(1).click();
  await until(
    async () =>
      (await cmd("file.inspect", { readOnly: true })).path ===
      root + "/other.md",
  );
  await cmd("file.open", { path: root + "/review.md" });
  await cmd("group.splitRight");
  await cmd("markdown.preview");
  const group = (await state()).activeGroup;
  await page.locator(`[data-group="${group}"] .image-expand`).first().waitFor();
  await cmd("group.focus", { group: 1 });
  await cmd("preview.image.open", { group, index: 1 });
  await dialog.waitFor();
  assert.match((await imageState()).title, /Linked illustration/);
  await cmd("preview.image.close");
  // Shared viewer and command math must still handle Mermaid.
  await page.locator('[data-group="1"] .diagram-expand').waitFor();
  await cmd("diagram.open", { group: 1 });
  await page
    .getByRole("dialog", { name: "Expanded Mermaid diagram" })
    .waitFor();
  await cmd("diagram.actualSize");
  assert.equal((await state()).diagram.scale, 1);
  assert.equal((await state()).expandedImage, null);
  await cmd("diagram.zoom", { factor: 2 });
  assert.equal((await state()).diagram.scale, 2);
  await cmd("diagram.close");
  assert.equal(
    (await cmd("file.inspect", { path: root + "/review.md", readOnly: true }))
      .text,
    markdown,
  );
  console.log(
    JSON.stringify({
      passed: true,
      remote,
      base,
      checks: [
        "embedded raster images",
        "button and image click",
        "linked image navigation",
        "fit zoom pan and keyboard",
        "palette and API equivalence",
        "focus restoration",
        "split targeting",
        "missing image guard",
        "no additional image reads",
        "Mermaid regression",
      ],
    }),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (remote && /^\/tmp\/owlet-images-[\w-]+$/.test(root))
      fixture.python(`import shutil;shutil.rmtree(${JSON.stringify(root)})`);
  });
