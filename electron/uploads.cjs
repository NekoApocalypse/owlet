const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { inspectSources, importFiles } = require("./transfers.cjs");
const active = (item) =>
  ["queued", "uploading", "stopping", "finishing"].includes(item.status);

// One queue per window. Transfers survive a renderer reload but never cross
// window boundaries. Only confirmed chunk bytes count as progress.
class UploadQueue {
  constructor(publish) {
    this.items = [];
    this.tail = Promise.resolve();
    this.publish = publish;
  }
  snapshot() {
    return this.items.map(({ cancelled, ...item }) => ({ ...item }));
  }
  emit() {
    this.publish(this.snapshot());
  }
  cancel(id) {
    if (typeof id !== "string") throw Error("Choose an upload to stop.");
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw Error("Upload no longer exists.");
    if (!["queued", "uploading"].includes(item.status)) return false;
    item.cancelled = true;
    item.status = item.status === "queued" ? "cancelled" : "stopping";
    this.emit();
    return true;
  }
  stop() {
    for (const item of this.items) this.cancel(item.id);
  }
  async add(connection, root, directory, sources) {
    if (typeof directory !== "string" || !directory || directory.includes("\0"))
      throw Error("Choose a destination folder.");
    const sourcesInfo = inspectSources(sources);
    if (this.items.filter(active).length + sourcesInfo.length > 100)
      throw Error(
        "Wait for pending uploads before adding more than 100 files.",
      );
    this.items = this.items.filter(active);
    const batch = sourcesInfo.map(({ file, before }) => ({
      id: randomUUID(),
      name: path.basename(file),
      directory,
      path:
        directory.replaceAll("\\", "/").replace(/\/$/, "") +
        "/" +
        path.basename(file),
      size: before.size,
      transferred: 0,
      status: "queued",
      remote: connection.kind === "ssh",
    }));
    this.items.push(...batch);
    this.emit();
    const paths = [];
    const jobs = batch.map((item, index) => {
      const job = this.tail.then(async () => {
        if (item.cancelled) return;
        item.status = "uploading";
        this.emit();
        let lastProgress = 0;
        try {
          const result = await importFiles(
            connection,
            root,
            directory,
            [sourcesInfo[index].file],
            {
              cancelled: () => item.cancelled,
              progress: (bytes, size) => {
                item.transferred = bytes;
                item.size = size;
                if (Date.now() - lastProgress > 100 || bytes === size) {
                  lastProgress = Date.now();
                  this.emit();
                }
              },
              committing: () => {
                item.status = "finishing";
                this.emit();
              },
            },
          );
          paths.push(...result.paths);
          item.status = "completed";
        } catch (error) {
          item.status = item.cancelled ? "cancelled" : "failed";
          if (!item.cancelled) item.error = error.message;
        }
        this.emit();
      });
      this.tail = job.catch(() => {});
      return job;
    });
    await Promise.all(jobs);
    return {
      paths,
      cancelled: batch.filter((item) => item.status === "cancelled").length,
      failed: batch.filter((item) => item.status === "failed").length,
    };
  }
}
module.exports = { UploadQueue };
