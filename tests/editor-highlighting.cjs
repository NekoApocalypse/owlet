const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const base = fs.mkdtempSync(path.join(workspace, "artifacts/highlighting-"));
const root = path.join(base, "Syntax review");
fs.mkdirSync(root);
const markdown =
  '# A clearer view\n\n**Bold** and *italic* with `inline()` code.\n\n[Read the guide](https://example.com)\n\n- A compact list\n\n> A useful observation\n\n~~Old text~~\n\n```TypeScript title=example\nconst greeting: string = "hello"; // comment\n```\n';
const fixtures = {
  "Reading.md": markdown,
  "UPPER.MD": markdown,
  "Notes.mdown": markdown,
  "sample.TS": 'const greeting: string = "hello"; // comment\n',
  "sample.py": 'def greeting():\n    return "hello" # comment\n',
  "sample.rs": 'fn main() { let greeting = "hello"; } // comment\n',
  "sample.go": 'package main\nfunc main() { greeting := "hello" } // comment\n',
  "sample.cpp": 'int main() { const char *greeting = "hello"; } // comment\n',
  "sample.sh": '# comment\necho "hello"\n',
  "sample.ps1": '# comment\nWrite-Output "hello"\n',
  Dockerfile: 'FROM alpine\n# comment\nRUN echo "hello"\n',
  "sample.json": '{"greeting": "hello", "count": 42}\n',
  "sample.yaml": '# comment\ngreeting: "hello"\n',
  "sample.toml": '# comment\ngreeting = "hello"\n',
  "sample.html": '<!-- comment -->\n<h1 class="greeting">hello</h1>\n',
  "sample.css": "/* comment */\nh1 { color: red; }\n",
  "plain.unknown": 'const greeting = "hello";\n',
  "plain.constructor": 'const greeting = "hello";\n',
  "unknown-fence.md": "```constructor\nplain text\n```\n",
};
for (const [name, text] of Object.entries(fixtures))
  fs.writeFileSync(path.join(root, name), text);
let app;
const errors = [],
  results = [];
(async () => {
  app = await _electron.launch({
    ...(process.env.LWR_PACKAGED
      ? {
          executablePath: path.resolve(process.env.LWR_PACKAGED),
          args: ["--local", root],
        }
      : { args: [workspace, "--local", root] }),
    env: { ...process.env, OWLET_USER_DATA: path.join(base, "profile") },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('[data-ready="true"]').waitFor();
  const cmd = (id, args = {}) =>
    page.evaluate(({ id, args }) => window.owletCommands.execute(id, args), {
      id,
      args,
    });
  await cmd("terminal.toggle");
  for (const name of Object.keys(fixtures)) {
    await cmd("file.open", {
      path: path.join(root, name).replaceAll("\\", "/"),
    });
    if (/\.(md|mdown)$/i.test(name)) await cmd("markdown.source");
    await page.locator(".cm-content").waitFor();
    await page.waitForTimeout(150);
    const lines = await page.locator(".cm-line").evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent,
        base: getComputedStyle(el).color,
        spans: [...el.querySelectorAll("span")].map((s) => ({
          text: s.textContent,
          color: getComputedStyle(s).color,
          weight: getComputedStyle(s).fontWeight,
          style: getComputedStyle(s).fontStyle,
          decoration: getComputedStyle(s).textDecorationLine,
        })),
      })),
    );
    const spans = lines.flatMap((l) => l.spans);
    if (["Reading.md", "UPPER.MD", "Notes.mdown"].includes(name)) {
      const line = (text) => lines.find((l) => l.text.includes(text));
      assert(line("A clearer").spans.some((s) => Number(s.weight) >= 700));
      assert(
        line("inline()").spans.some(
          (s) =>
            s.text.includes("inline()") && s.color !== line("inline()").base,
        ),
      );
      assert(
        line("A compact").spans.some(
          (s) => s.text.includes("-") && s.color !== line("A compact").base,
        ),
      );
      assert(
        line("observation").spans.some(
          (s) => s.color !== line("observation").base,
        ),
      );
      assert(
        line("Old text").spans.some((s) =>
          s.decoration.includes("line-through"),
        ),
      );
      const code = line("const greeting");
      assert(
        new Set(code.spans.map((s) => s.color)).size >= 3,
        `${name}: fenced tokens must differ`,
      );
      if (name === "Reading.md") {
        await page
          .locator(".editor-group.active-group")
          .screenshot({ path: path.join(base, "markdown-source.png") });
        await cmd("markdown.preview");
        await page.locator(".markdown-preview h1").waitFor();
        await cmd("markdown.source");
        await page.locator(".cm-content").waitFor();
        assert.equal(
          (await page.locator(".cm-line").allTextContents()).join("\n"),
          markdown,
        );
      }
    } else if (name.startsWith("plain."))
      assert.equal(spans.length, 0, `${name}: unknown files stay plain`);
    else if (name !== "unknown-fence.md")
      assert(
        new Set(spans.map((s) => s.color)).size >= 2,
        `${name}: needs distinct token styles`,
      );
    results.push(name);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(base, "results.json"),
    JSON.stringify({ status: "passed", results }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", base, results }, null, 2));
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
