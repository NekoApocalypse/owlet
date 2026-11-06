const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  ProjectSearch,
  validateSearch,
} = require("../electron/project-search.cjs");
const base = fs.mkdtempSync(path.resolve("artifacts/project-search-unit-"));
const files = {
  "notes.md": "intro\n😀 中文 Needle exact\nneedles\n",
  "deep/a/b/c/d/e/f/note.txt": "Needle deep\n",
  "hidden/.secret.txt": "Needle hidden\n",
  "ignored.txt": "Needle ignored\n",
  ".ignore": "ignored.txt\n",
  "deps/lib.txt": "Needle dependency\n",
  "huge.txt": "Needle\n" + "x".repeat(2 * 1024 * 1024),
  "many.txt": "needle\n".repeat(500),
  "literal.txt": "$(echo hello)\n",
};
for (const [name, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
  fs.writeFileSync(path.join(base, name), text);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function collect(api, id, timeout = 10000) {
  const started = Date.now(),
    matches = [];
  let result;
  do {
    if (Date.now() - started > timeout) throw Error("Search timed out in test");
    result = await api.poll(id);
    matches.push(...result.matches);
    await sleep(10);
  } while (result.pending || result.status === "running");
  return { ...result, matches };
}
async function exercise(api) {
  let serial = 0;
  const run = async (args) => {
    const id = "case-" + ++serial;
    await api.start(
      validateSearch({
        id,
        query: "needle",
        exclude: "deps/**",
        maxFileSizeMB: 1,
        ...args,
      }),
    );
    return collect(api, id);
  };
  let result = await run({ include: "notes.md" });
  assert.equal(result.status, "complete");
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].column, 7);
  assert.equal(result.matches[0].match, "Needle");
  result = await run({ include: "notes.md", wholeWord: true });
  assert.equal(result.matches.length, 1);
  result = await run({ include: "notes.md", caseSensitive: true });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].line, 3);
  result = await run({ include: "deep/**" });
  assert.equal(result.matches.length, 1);
  result = await run({ include: "deep/**", maxDepth: 2 });
  assert.equal(result.matches.length, 0);
  result = await run({ include: "hidden/**" });
  assert.equal(
    result.matches.length,
    1,
    "explicit include globs override hidden rules",
  );
  result = await run({ include: "hidden/**", includeHidden: true });
  assert.equal(result.matches.length, 1);
  result = await run({ include: "", exclude: "deps/**,many.txt" });
  assert.ok(
    !result.matches.some((item) => /ignored|huge|deps|secret/.test(item.path)),
  );
  result = await run({
    includeIgnored: true,
    include: "",
    exclude: "deps/**,many.txt",
  });
  assert.ok(result.matches.some((item) => item.path.endsWith("ignored.txt")));
  result = await run({ directory: "deep", include: "" });
  assert.equal(result.matches.length, 1);
  result = await run({ directory: ".." });
  assert.equal(result.status, "error");
  assert.match(result.reason, /inside this workspace/);
  result = await run({ query: "$(echo hello)" });
  assert.equal(result.matches.length, 1);
  result = await run({ include: "many.txt", maxResults: 7 });
  assert.equal(result.matches.length, 7);
  assert.equal(result.status, "limited");
  result = await run({ query: "absent-needle-123" });
  assert.equal(result.status, "complete");
  assert.equal(result.matches.length, 0);
}
test("local ripgrep: scopes, ignore rules, literal and Unicode positions, depth, limits", async () => {
  const service = new ProjectSearch();
  try {
    await exercise({
      start: (args) => service.start("owner", base, args),
      poll: (id) => service.poll("owner", id),
    });
  } finally {
    service.dispose("owner");
  }
});
test("search worker: timeout and stop terminate the actual child; replacement and isolation", async () => {
  const fake = path.join(base, "slow-engine.cjs");
  fs.writeFileSync(fake, "setInterval(()=>{},1000)");
  const service = new ProjectSearch({ file: process.execPath, args: [fake] });
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    service.start("a", base, { id: "one", query: "a", timeoutSeconds: 1 });
    while (!service.jobs.get("a").pid) await sleep(10);
    const pid = service.jobs.get("a").pid;
    const result = await collect(
      { poll: (id) => service.poll("a", id) },
      "one",
    );
    assert.equal(result.status, "limited");
    assert.match(result.reason, /Time limit/);
    assert.equal(alive(pid), false);
    service.start("a", base, { id: "two", query: "a" });
    service.start("b", base, { id: "other", query: "b" });
    while (!service.jobs.get("a").pid || !service.jobs.get("b").pid)
      await sleep(10);
    const oldPid = service.jobs.get("a").pid;
    service.stop("a", "two");
    await sleep(100);
    assert.equal(alive(oldPid), false);
    assert.equal(service.poll("b", "other").status, "running");
    service.start("b", base, { id: "new", query: "b" });
    assert.throws(() => service.poll("b", "other"), /no longer/);
  } finally {
    service.dispose("a");
    service.dispose("b");
  }
});
test(
  "real SSH search uses its own worker and leaves control requests responsive",
  { skip: !process.env.OWLET_SSH_TARGET, timeout: 60000 },
  async () => {
    const { Connection } = require("../electron/connection.cjs"),
      { python, target } = require("./fixture.cjs");
    const root = python(
      'import tempfile;print(tempfile.mkdtemp(prefix="owlet-search-"))',
    );
    const { execFileSync } = require("node:child_process");
    const script = Buffer.from(
      `import os,json,sys,zlib\nr=${JSON.stringify(root)}\nfor name,text in json.loads(zlib.decompress(sys.stdin.buffer.read())).items():\n p=os.path.join(r,name);os.makedirs(os.path.dirname(p),exist_ok=True);open(p,'w',encoding='utf8').write(text)`,
    ).toString("base64");
    execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        target,
        `python3 -c "import base64;exec(base64.b64decode('${script}'))"`,
      ],
      {
        input: require("node:zlib").deflateSync(
          Buffer.from(JSON.stringify(files)),
        ),
        windowsHide: true,
        timeout: 30000,
      },
    );
    const connection = new Connection(target);
    await connection.connect();
    try {
      assert.ok(connection.metrics.bootstrap < 32768);
      await exercise({
        start: (args) =>
          connection.request("search-start", { ...args, root, owner: "tests" }),
        poll: (id) => connection.request("search-poll", { owner: "tests", id }),
      });
      await connection.request("search-start", {
        ...validateSearch({ id: "stop", query: "needle", maxResults: 10000 }),
        root,
        owner: "tests",
      });
      const at = Date.now();
      await connection.request("stat", { path: root + "/notes.md" });
      assert.ok(
        Date.now() - at < 2000,
        "stat remains responsive during search",
      );
      await connection.request("search-stop", { owner: "tests", id: "stop" });
    } finally {
      connection.close();
      if (/^\/tmp\/owlet-search-[\w-]+$/.test(root))
        python(`import shutil;shutil.rmtree(${JSON.stringify(root)})`);
    }
  },
);
