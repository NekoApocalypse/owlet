const path = require("node:path");
const { Worker } = require("node:worker_threads");
const schema = require("./settings-schema.json");
const bounds = {
  maxResults: [1, 10000, 2000],
  timeoutSeconds: [1, 120, 15],
  maxResultMB: [1, 8, 2],
  maxFileSizeMB: [1, 32, 4],
  maxDepth: [0, 100, 0],
  threads: [1, 4, 2],
};
function validateSearch(args) {
  if (!args || typeof args !== "object") throw Error("Enter a search query.");
  if (typeof args.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(args.id))
    throw Error("Invalid search ID.");
  if (
    typeof args.query !== "string" ||
    !args.query.trim() ||
    args.query.length > 512 ||
    /[\r\n\0]/.test(args.query)
  )
    throw Error("Search for 1–512 characters on one line.");
  const options = { id: args.id, query: args.query };
  for (const key of ["directory", "include", "exclude"]) {
    const value = args[key] ?? "";
    if (
      typeof value !== "string" ||
      value.length > 4096 ||
      /[\r\n\0]/.test(value)
    )
      throw Error(`Invalid search ${key}.`);
    options[key] = value;
  }
  for (const key of [
    "caseSensitive",
    "wholeWord",
    "includeHidden",
    "includeIgnored",
  ]) {
    if (args[key] !== undefined && typeof args[key] !== "boolean")
      throw Error(`Invalid search ${key}.`);
    options[key] = args[key] ?? false;
  }
  for (const [key, [min, max, fallback]] of Object.entries(bounds)) {
    const value = args[key] ?? schema[`search.${key}`]?.default ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max)
      throw Error(`Invalid search ${key}: use ${min}–${max}.`);
    options[key] = value;
  }
  return options;
}
class ProjectSearch {
  constructor(engine) {
    this.jobs = new Map();
    this.engine = engine;
  }
  start(owner, root, raw) {
    const options = validateSearch(raw);
    this.stop(owner);
    const job = {
      id: options.id,
      queue: [],
      status: "running",
      count: 0,
      reason: "",
      scope: root,
      worker: null,
      pid: null,
    };
    this.jobs.set(owner, job);
    const worker = new Worker(path.join(__dirname, "search-worker.cjs"), {
      workerData: { root, options, engine: this.engine },
    });
    job.worker = worker;
    worker.on("message", (message) => {
      if (message.pid) {
        job.pid = message.pid;
        if (job.status === "stopped") this.kill(job);
        return;
      }
      if (job.status === "stopped") return;
      if (message.matches) job.queue.push(...message.matches);
      Object.assign(
        job,
        Object.fromEntries(
          Object.entries(message).filter(([key]) =>
            ["status", "reason", "count", "scope"].includes(key),
          ),
        ),
      );
    });
    worker.on("error", (error) => {
      if (job.status !== "stopped") {
        job.status = "error";
        job.reason = error.message;
      }
    });
    worker.on("exit", () => {
      job.pid = null;
      if (job.status === "running") {
        job.status = "error";
        job.reason = "Search worker exited unexpectedly.";
      }
    });
    return { id: job.id };
  }
  kill(job) {
    job.worker?.postMessage("stop");
    if (job.pid) {
      try {
        process.kill(job.pid);
      } catch {}
    }
  }
  stop(owner, id) {
    const job = this.jobs.get(owner);
    if (!job || (id && job.id !== id)) return false;
    if (job.status === "running") {
      job.status = "stopped";
      job.reason = "Stopped by user";
      this.kill(job);
    }
    return true;
  }
  poll(owner, id) {
    const job = this.jobs.get(owner);
    if (!job || job.id !== id) throw Error("Search no longer exists.");
    const matches = [];
    let bytes = 0;
    while (job.queue.length && matches.length < 64) {
      const size = Buffer.byteLength(JSON.stringify(job.queue[0]));
      if (matches.length && bytes + size > 16384) break;
      matches.push(job.queue.shift());
      bytes += size;
    }
    return {
      id,
      matches,
      status: job.status,
      reason: job.reason,
      count: job.count,
      scope: job.scope,
      pending: job.queue.length > 0,
    };
  }
  dispose(owner) {
    this.stop(owner);
    this.jobs.delete(owner);
  }
}
module.exports = { ProjectSearch, validateSearch };
