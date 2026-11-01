const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { Connection } = require("../electron/connection.cjs");
const { createFixture, python } = require("./fixture.cjs");
const connection = new Connection(require("./fixture.cjs").target);
let fixture, terminal;
before(
  async () => {
    fixture = createFixture();
    await connection.connect();
  },
  { timeout: 45000 },
);
after(async () => {
  connection.close();
});
test("strict SSH bootstrap is below 32 KiB and home is real", () => {
  assert.equal(
    connection.state.home,
    python('import os;print(os.path.expanduser("~"))'),
  );
  assert.ok(connection.metrics.bootstrap < 32768);
});
test("directory listing is paged, with no dropped entries", async () => {
  const first = await connection.request("list", {
    path: fixture.root + "/many_entries",
  });
  const second = await connection.request("list", {
    path: fixture.root + "/many_entries",
    offset: first.next,
  });
  assert.equal(first.entries.length, 100);
  assert.equal(second.entries.length, 35);
  assert.equal(
    new Set([...first.entries, ...second.entries].map((item) => item.path))
      .size,
    135,
  );
});
test("save detects an intervening agent edit and preserves newer content", async () => {
  const file = fixture.root + "/save-test.txt";
  const initial = await connection.download({ path: file });
  const agent = await connection.request("save", {
    path: file,
    text: "agent update\n",
    revision: initial.revision,
  });
  await assert.rejects(
    connection.request("save", {
      path: file,
      text: "stale user update\n",
      revision: initial.revision,
    }),
    /CONFLICT/,
  );
  assert.equal(
    (await connection.download({ path: file })).text,
    "agent update\n",
  );
  await connection.request("save", {
    path: file,
    text: "explicit replacement\n",
    revision: agent.revision,
  });
  assert.equal(
    (await connection.download({ path: file })).text,
    "explicit replacement\n",
  );
});
test("image resolution: ancestor, strict relative, encoded names, missing paths and nearest match", async () => {
  const document = fixture.root + "/docs/topic/paths.md",
    root = fixture.root;
  for (const source of [
    "images/landscape.png",
    "../../images/landscape.png",
    "../../images/space%20name.png",
    "../../images/%E5%9B%BE.png",
  ]) {
    const image = await connection.download({ source, document, root }, true);
    assert.ok(image.url.startsWith("data:image/png;base64,"));
  }
  await assert.rejects(
    connection.download(
      { source: "./images/landscape.png", document, root },
      true,
    ),
    /Image not found/,
  );
  await assert.rejects(
    connection.download(
      { source: "https://example.com/a.png", document, root },
      true,
    ),
    /not loaded/,
  );
  python(
    `import os,shutil\np='${root}/docs/topic/images'\nos.makedirs(p,exist_ok=True)\nshutil.copyfile('${root}/images/landscape.png',p+'/landscape.png')`,
  );
  const nearest = await connection.download(
    { source: "images/landscape.png", document, root },
    true,
  );
  assert.equal(nearest.path, root + "/docs/topic/images/landscape.png");
});
test(
  "real PTY: cwd, size, zoxide shell setup and lwr callback",
  { timeout: 45000 },
  async () => {
    terminal = "acceptance-shell";
    let output = "";
    connection.on("remote-event", (event) => {
      if (event.terminal === terminal && event.data)
        output += Buffer.from(event.data, "base64").toString();
    });
    await connection.request("terminal-start", {
      terminal,
      path: fixture.root,
      rows: 31,
      cols: 99,
    });
    connection.notify("terminal-input", {
      terminal,
      data: Buffer.from(
        "printf '__READY__\\n'; pwd; stty size; command -v zoxide; lwr .\n",
      ).toString("base64"),
    });
    const opened = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No lwr callback. Terminal output: " + output)),
        30000,
      );
      connection.on("remote-event", (event) => {
        if (event.event === "open") {
          clearTimeout(timeout);
          resolve(event);
        }
      });
    });
    assert.equal(opened.path, fixture.root);
    assert.equal(opened.directory, true);
    assert.match(output, /31 99/);
    if (process.env.OWLET_TEST_ZOXIDE_PROJECT)
      assert.match(output, /\/[^\r\n ]+\/zoxide/);
    await connection.request("terminal-resize", {
      terminal,
      rows: 34,
      cols: 111,
    });
    connection.notify("terminal-input", {
      terminal,
      data: Buffer.from("stty size\n").toString("base64"),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.match(output, /34 111/);
    fs.writeFileSync(
      path.join(__dirname, "../artifacts/terminal-proof.txt"),
      output,
    );
  },
);
test("existing zoxide project jump works when its database volume is writable", async (t) => {
  const expectedProject = process.env.OWLET_TEST_ZOXIDE_PROJECT;
  if (!expectedProject)
    return t.skip(
      "Set OWLET_TEST_ZOXIDE_PROJECT for an optional existing zoxide entry",
    );
  let output = "";
  const capture = (event) => {
    if (event.terminal === terminal && event.data)
      output += Buffer.from(event.data, "base64").toString();
  };
  connection.on("remote-event", capture);
  const jumped = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error("zoxide project jump did not open a window: " + output),
        ),
      15000,
    );
    const listener = (event) => {
      if (event.event === "open") {
        clearTimeout(timer);
        connection.off("remote-event", listener);
        resolve(event);
      }
    };
    connection.on("remote-event", listener);
  });
  connection.notify("terminal-input", {
    terminal,
    data: Buffer.from(
      `z '${expectedProject.replaceAll("'", "'\\''")}'; pwd; lwr .\n`,
    ).toString("base64"),
  });
  const result = await jumped;
  connection.off("remote-event", capture);
  const blocked =
    result.path !== expectedProject &&
    output.includes("zoxide: could not write to database") &&
    output.includes("No space left on device");
  fs.writeFileSync(
    path.join(__dirname, "../artifacts/zoxide-result.json"),
    JSON.stringify(
      {
        status: blocked ? "blocked-by-server-disk" : "passed",
        path: result.path,
        output,
      },
      null,
      2,
    ),
  );
  if (blocked)
    return t.skip(
      "Server root disk is full: existing zoxide cannot write its database. LWR terminal and launcher passed separately.",
    );
  assert.equal(result.path, expectedProject, output);
});
test("small metadata request can complete during chunked image download", async () => {
  const image = connection.download(
    { path: fixture.root + "/images/bulk.png" },
    true,
  );
  const list = await connection.request("list", { path: fixture.root });
  assert.ok(list.entries.length > 0);
  assert.ok((await image).url.length > 500000);
});
test("reconnect recreates only the helper; project files persist", async () => {
  const exit = once(connection, "state");
  connection.close();
  await exit;
  await connection.connect();
  assert.equal(
    (await connection.download({ path: fixture.root + "/save-test.txt" })).text,
    "explicit replacement\n",
  );
  fs.writeFileSync(
    path.join(__dirname, "../artifacts/remote-metrics.json"),
    JSON.stringify(connection.metrics, null, 2),
  );
});
