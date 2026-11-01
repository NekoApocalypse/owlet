const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
const { shape } = require("./throttle-proxy.cjs");
test("network shaper preserves exact byte order and flushes queued bytes before EOF", async () => {
  for (let trial = 0; trial < 5; trial++) {
    const source = new PassThrough(),
      destination = new PassThrough({ highWaterMark: 2048 });
    const input = randomBytes(128 * 1024),
      chunks = [];
    let count = 0;
    destination.on("data", (chunk) => chunks.push(chunk));
    const ended = once(destination, "end");
    shape(source, destination, (n) => (count += n), {
      bytesPerSecond: 1024 * 1024,
      oneWayDelay: 2,
    });
    for (let offset = 0; offset < input.length;) {
      const size = 1 + ((input[offset] * 13) % 2048);
      source.write(input.subarray(offset, offset + size));
      offset += size;
      if (offset % 3 === 0)
        await new Promise((resolve) => setImmediate(resolve));
    }
    source.end();
    await ended;
    assert.deepEqual(Buffer.concat(chunks), input);
    assert.equal(count, input.length);
  }
});
