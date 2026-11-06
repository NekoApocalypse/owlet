const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const { root, options: o, engine } = workerData;
let child,
  stopped = false,
  finished = false,
  reason = "",
  count = 0,
  bytes = 0,
  batch = [],
  stderr = "",
  timer;
const send = (message) => parentPort.postMessage(message);
const flush = () => {
  if (batch.length) {
    send({ matches: batch, count });
    batch = [];
  }
};
const pulse = setInterval(flush, 100);
function stop(why) {
  if (finished) return;
  stopped = true;
  reason ||= why;
  child?.kill();
}
function finish(status, why = reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearInterval(pulse);
  flush();
  send({ status, reason: why, count });
  parentPort.close();
}
parentPort.on("message", () => stop("Stopped by user"));
timer = setTimeout(() => stop("Time limit reached"), o.timeoutSeconds * 1000);
function decode(field) {
  return (
    field.text ?? Buffer.from(field.bytes || "", "base64").toString("utf8")
  );
}
(async () => {
  const canonical = await fs.realpath(root);
  const scope = await fs.realpath(path.resolve(canonical, o.directory || "."));
  const relative = path.relative(canonical, scope);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative) ||
    !(await fs.stat(scope)).isDirectory()
  )
    throw Error("Search scope must be a folder inside this workspace.");
  send({ scope: scope.replaceAll("\\", "/") });
  const rgPath = engine?.file || (await import("@vscode/ripgrep")).rgPath;
  if (stopped)
    return finish(reason === "Stopped by user" ? "stopped" : "limited");
  const args = [
    "--no-config",
    "--json",
    "--fixed-strings",
    "--color",
    "never",
    "--threads",
    String(o.threads),
    "--max-filesize",
    `${o.maxFileSizeMB}M`,
  ];
  if (!o.caseSensitive) args.push("--ignore-case");
  if (o.wholeWord) args.push("--word-regexp");
  if (o.includeHidden) args.push("--hidden");
  if (o.includeIgnored) args.push("--no-ignore");
  if (o.maxDepth) args.push("--max-depth", String(o.maxDepth));
  for (const glob of o.include
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean))
    args.push("--glob", glob);
  for (const glob of o.exclude
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean))
    args.push("--glob", "!" + glob.replace(/^!/, ""));
  args.push(
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/.owlet-*/**",
    "--",
    o.query,
    ".",
  );
  child = spawn(rgPath, [...(engine?.args || []), ...args], {
    cwd: scope,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  send({ pid: child.pid });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stopped) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      buffer = "";
      stop("Oversized result line; narrow the search");
      return;
    }
    let at;
    while (!stopped && (at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        stop("Invalid search output");
        break;
      }
      if (message.type !== "match") continue;
      const data = message.data,
        match = data.submatches[0];
      if (!match) continue;
      const text = decode(data.lines),
        raw = Buffer.from(text);
      const column = raw.subarray(0, match.start).toString("utf8").length;
      const matched = raw.subarray(match.start, match.end).toString("utf8");
      const start = Math.max(0, column - 100),
        end = Math.min(
          text.trimEnd().length,
          column + Math.min(matched.length, 200) + 160,
        );
      const file = path.resolve(scope, decode(data.path));
      const within = path.relative(scope, file);
      if (within.startsWith(".." + path.sep) || path.isAbsolute(within)) {
        stop("Search returned an out-of-scope path");
        break;
      }
      const item = {
        path: file.replaceAll("\\", "/"),
        line: data.line_number,
        column: column + 1,
        match: matched,
        text: text.slice(start, end),
        start: column - start,
        end: Math.min(end - start, column - start + matched.length),
        clippedStart: start > 0,
        clippedEnd: end < text.trimEnd().length,
      };
      const size = Buffer.byteLength(JSON.stringify(item));
      if (bytes + size > o.maxResultMB * 1024 * 1024 || count >= o.maxResults) {
        stop("Result limit reached");
        break;
      }
      batch.push(item);
      bytes += size;
      count++;
      if (batch.length >= 32) flush();
      if (count >= o.maxResults) stop("Result limit reached");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  child.on("error", (error) => finish("error", error.message));
  child.on("close", (code) =>
    finish(
      stopped
        ? reason === "Stopped by user"
          ? "stopped"
          : "limited"
        : code === 0 || code === 1
          ? "complete"
          : "error",
      reason || stderr.trim(),
    ),
  );
})().catch((error) => finish("error", error.message));
