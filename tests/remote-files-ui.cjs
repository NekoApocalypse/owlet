const { _electron } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { python, target } = require("./fixture.cjs");
const workspace = path.resolve(__dirname, ".."),
  base = fs.mkdtempSync(path.join(workspace, "artifacts/remote-files-ui-")),
  profile = path.join(base, "profile");
fs.mkdirSync(profile);
const root = python(
  'import tempfile,os;root=tempfile.mkdtemp(prefix="owlet-drop-",dir=' +
    JSON.stringify(process.env.OWLET_TEST_TMPDIR || "/tmp") +
    ');os.mkdir(root+"/Inbox");print(root)',
);
const source = path.join(base, "外部-note.txt");
fs.writeFileSync(source, "uploaded from Windows\n");
let app, page;
async function until(fn) {
  let start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > 20000) throw Error("Timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? { executablePath: path.resolve(process.env.LWR_PACKAGED), args: [] }
      : { args: [workspace] }),
    env: {
      ...process.env,
      LWR_SSH_TARGET: target,
      LWR_ROOT: root,
      OWLET_USER_DATA: profile,
    },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  await page.locator('[data-ready="true"]').waitFor();
  const folder = page.locator('.tree-row[title="' + root + '/Inbox"]');
  const box = await folder.boundingBox(),
    cdp = await page.context().newCDPSession(page);
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      data: { items: [], files: [source], dragOperationsMask: 1 },
    });
  await until(async () => {
    const listing = await page.evaluate(
      (p) => window.lwr.remote("list", { path: p }),
      root + "/Inbox",
    );
    return listing.entries.some((e) => e.name === "外部-note.txt");
  });
  await cmd("explorer.expand", { path: root + "/Inbox" });
  const file = root + "/Inbox/外部-note.txt";
  await page
    .locator('.tree-row[title="' + file + '"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Download…", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  const dest = path.join(base, "downloaded.txt");
  await cmd("file.download", { path: file, destination: dest });
  assert.equal(fs.readFileSync(dest, "utf8"), fs.readFileSync(source, "utf8"));
  await cmd("file.copy", { path: file });
  await cmd("file.paste", { directory: root + "/Inbox" });
  const copied = root + "/Inbox/外部-note copy.txt";
  await cmd("file.cut", { path: copied });
  await cmd("file.paste", { directory: root });
  const question = (await cmd("workspace.state", { readOnly: true }))
    .confirmation;
  await cmd("confirmation.accept", { token: question.token });
  const moved = await page.evaluate(
    (p) => window.lwr.remote("read", { path: p }),
    root + "/外部-note copy.txt",
  );
  assert.equal(moved.text, "uploaded from Windows\n");
  await cmd("file.open", { path: file });
  await cmd("editor.vim");
  await cmd("editor.setText", { text: "dirty" });
  await cmd("editor.vimCommand", { command: "e!" });
  assert.equal(
    (await cmd("file.inspect", { readOnly: true })).text,
    "uploaded from Windows\n",
  );
  await cmd("file.index.refresh");
  await until(async () => {
    const index = await cmd("file.search", { query: "外note" });
    return !index.loading && index.matches.length === 2;
  });
  console.log(
    JSON.stringify({
      passed: [
        "Native external drop uploads over real SSH",
        "Remote-only Download menu and binary-safe local download",
        "Remote Vim reload and indexed fuzzy search",
      ],
    }),
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
  });
