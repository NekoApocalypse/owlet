const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { UserSettings, validate } = require("../electron/settings.cjs");
test("Settings accepts JSONC, preserves unknown keys, rejects wrong types and limits", () => {
  assert.equal(
    validate('{ // comment\n "editor.fontSize": 18, "future.key": true, }')[
      "editor.fontSize"
    ],
    18,
  );
  for (const text of [
    "[]",
    "null",
    "{",
    '{"editor.fontSize":"18"}',
    '{"terminal.scrollback":2.5}',
    '{"preview.fontSize":400}',
    '{"preview.maxWidth":-1}',
    '{"preview.maxWidth":10001}',
    '{"preview.maxWidth":900.5}',
    '{"preview.maxWidth":"900px"}',
    '{"markdown.defaultView":"random"}',
    '{"editor.vimMode":1}',
    '{"editor.fontFamily":""}',
  ])
    assert.throws(() => validate(text));
  for (const width of [0, 900, 1100, 10000])
    assert.equal(
      validate(JSON.stringify({ "preview.maxWidth": width }))[
        "preview.maxWidth"
      ],
      width,
    );
});
test("Settings store uses revisions and preserves disk contents on conflict or invalid save", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owlet-settings-"));
  try {
    const file = path.join(dir, "profile", "settings.json"),
      store = new UserSettings(file);
    const first = store.read();
    assert.equal(first.revision, "missing");
    assert.equal(fs.existsSync(file), false);
    const saved = store.save({
      text: '{"editor.fontSize":16}',
      revision: first.revision,
    });
    assert.throws(
      () => store.save({ text: "{}", revision: first.revision }),
      /CONFLICT/,
    );
    assert.throws(
      () =>
        store.save({
          text: '{"editor.fontSize":-1}',
          revision: saved.revision,
        }),
      /Invalid/,
    );
    assert.equal(store.read().text, saved.text);
    fs.writeFileSync(file, '{"preview.fontSize":18}');
    assert.throws(
      () => store.save({ text: "{}", revision: saved.revision }),
      /CONFLICT/,
    );
    const current = store.read();
    assert.equal(
      store.save({ text: "{}", revision: current.revision }).text,
      "{}",
    );
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["settings.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
