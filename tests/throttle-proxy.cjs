// OpenSSH ProxyCommand: shape encrypted bytes without modifying the VPN/server.
const net = require("node:net");
const fs = require("node:fs");
function shape(
  source,
  destination,
  onBytes,
  { bytesPerSecond = 32000, oneWayDelay = 125 } = {},
) {
  const queue = [];
  let last = performance.now(),
    queued = 0,
    running = false,
    ended = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !destination.destroyed) {
        const { chunk, at } = queue.shift();
        const remaining = at - performance.now();
        if (remaining > 0)
          await new Promise((resolve) => setTimeout(resolve, remaining));
        if (destination.destroyed) break;
        queued -= chunk.length;
        onBytes(chunk.length);
        if (!destination.write(chunk))
          await new Promise((resolve) => {
            const done = () => {
              destination.off("drain", done);
              destination.off("close", done);
              resolve();
            };
            destination.once("drain", done);
            destination.once("close", done);
          });
        if (queued < 32768) source.resume();
      }
    } finally {
      running = false;
      if (ended && !queue.length && !destination.destroyed) destination.end();
    }
  }
  source.on("data", (data) => {
    const now = performance.now();
    for (let offset = 0; offset < data.length; offset += 1024) {
      const chunk = Buffer.from(data.subarray(offset, offset + 1024));
      const at =
        Math.max(now + oneWayDelay, last) +
        (chunk.length / bytesPerSecond) * 1000;
      last = at;
      queue.push({ chunk, at });
      queued += chunk.length;
    }
    if (queued > 65536) source.pause();
    void drain();
  });
  source.on("end", () => {
    ended = true;
    void drain();
  });
}
module.exports = { shape };
if (require.main === module) {
  const socket = net.connect({
    host: process.argv[2],
    port: Number(process.argv[3] || 22),
  });
  const metrics = {
    upload: 0,
    download: 0,
    bytesPerSecond: 32000,
    addedRoundTripMs: 250,
  };
  socket.on("connect", () => {
    shape(process.stdin, socket, (bytes) => (metrics.upload += bytes));
    shape(socket, process.stdout, (bytes) => (metrics.download += bytes));
  });
  socket.on("error", (error) => {
    process.stderr.write(error.message);
    process.exit(1);
  });
  process.stdout.on("error", () => socket.destroy());
  process.stdout.on("finish", () => process.exit());
  process.on("exit", () => {
    if (process.env.LWR_PROXY_METRICS)
      fs.writeFileSync(process.env.LWR_PROXY_METRICS, JSON.stringify(metrics));
  });
}
