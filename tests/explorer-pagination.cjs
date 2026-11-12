const { _electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/explorer-pagination-"));
const remote = !!process.env.OWLET_SSH_TARGET;
const fixture = remote ? require("./fixture.cjs") : null;
const root = remote
  ? fixture.python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-pagination-"))',
    )
  : path.join(base, "workspace").replaceAll("\\", "/");
const folders = Array.from(
  { length: 115 },
  (_, i) => `z-folder-${String(i).padStart(3, "0")}`,
);
const files = Array.from(
  { length: 135 },
  (_, i) => `file-${String(i).padStart(3, "0")}.txt`,
);
const expected = [...folders, ...files];
if (remote) {
  fixture.python(
    `import os\nr=${JSON.stringify(root)}\nfor name in ${JSON.stringify([...files].reverse())}:\n open(os.path.join(r,name),'w').close()\nfor name in ${JSON.stringify([...folders].reverse())}:\n os.mkdir(os.path.join(r,name))`,
  );
} else {
  fs.mkdirSync(root);
  for (const name of [...files].reverse())
    fs.writeFileSync(root + "/" + name, "");
  for (const name of [...folders].reverse()) fs.mkdirSync(root + "/" + name);
}
let app, page;
async function waitRows(count) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".tree-row[data-file-path]").length === count,
    count,
  );
  assert.deepEqual(
    await page
      .locator(".tree-row[data-file-path]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-file-path").split("/").pop()),
      ),
    expected.slice(0, count),
  );
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
      ...(remote ? { LWR_ROOT: root, LWR_SSH_TARGET: fixture.target } : {}),
    },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  // Check each page, not just the final set: late folders must precede all files.
  for (const offset of [0, 100, 200, 300]) {
    const listing = await page.evaluate(
      ({ root, offset }) => window.lwr.remote("list", { path: root, offset }),
      { root, offset },
    );
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      expected.slice(offset, offset + 100),
    );
    assert.equal(
      listing.next,
      offset + 100 < expected.length ? offset + 100 : null,
    );
  }
  await waitRows(100);
  await page
    .getByRole("button", { name: "Load next 100 entries", exact: true })
    .click();
  await waitRows(200);
  await cmd("explorer.loadMore", { path: root });
  await waitRows(250);
  assert.equal(await page.locator(".tree-more").count(), 0);
  await page
    .locator(".tree-row[data-file-path]")
    .nth(114)
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(base, "folder-file-boundary.png") });
  await cmd("explorer.refresh");
  await waitRows(100);
  await page
    .getByRole("button", { name: "Load next 100 entries", exact: true })
    .click();
  await waitRows(200);
  console.log(
    JSON.stringify({
      passed: true,
      remote,
      base,
      checks: [
        "directory-wide folders-first ordering",
        "three sorted pages",
        "no duplicates or missing entries",
        "button/API pagination",
        "refresh starts at first alphabetical page",
      ],
    }),
  );
})()
  .catch(async (error) => {
    if (page)
      await page
        .screenshot({ path: path.join(base, "failure.png") })
        .catch(() => {});
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
    if (remote && /^\/tmp\/owlet-pagination-[\w-]+$/.test(root))
      fixture.python(`import shutil;shutil.rmtree(${JSON.stringify(root)})`);
  });
