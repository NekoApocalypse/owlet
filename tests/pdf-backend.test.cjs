const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { LocalConnection } = require("../electron/local.cjs");
const { pdfFixture } = require("./pdf-fixture.cjs");
test("PDF byte reads preserve content, reject impostors and enforce size limits", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-pdf-backend-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const connection = new LocalConnection({}),
    file = path.join(root, "sample.PDF");
  fs.writeFileSync(file, pdfFixture());
  const result = await connection.download({ path: file }, false, true);
  assert(Buffer.from(result.data, "base64").equals(pdfFixture()));
  assert(result.stamp);
  fs.writeFileSync(file, "not PDF");
  await assert.rejects(
    connection.download({ path: file }, false, true),
    /valid PDF/,
  );
  fs.writeFileSync(file, "%PDF-");
  fs.truncateSync(file, 33 * 1024 * 1024);
  await assert.rejects(
    connection.download({ path: file }, false, true),
    /32 MiB/,
  );
});
