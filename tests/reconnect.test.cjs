const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { Connection } = require("../electron/connection.cjs");

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const children = [];
  const connection = new Connection("test-host", {
    spawnProcess() {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {
        child.killed = true;
      };
      children.push(child);
      return child;
    },
  });
  t.after(() => connection.close());
  const ready = () =>
    children
      .at(-1)
      .stdout.write(
        JSON.stringify({ event: "ready", home: "/home/test" }) + "\n",
      );
  const drop = (message = "Connection reset by peer") => {
    children.at(-1).stderr.write(message);
    children.at(-1).emit("exit", 255);
  };
  return { connection, children, ready, drop };
}

test("dropped transport rejects writes once, retries with capped backoff, and ignores stale events", async (t) => {
  const { connection: c, children, ready, drop } = fixture(t);
  const first = c.connect();
  ready();
  await first;
  const write = c.request("save", { path: "/test", text: "unsaved" });
  const rejected = assert.rejects(write, /reset/);
  const stale = children[0];
  drop();
  await rejected;
  assert.equal(c.pending.size, 0);
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    assert.equal(c.state.retryDelay, delay);
    const count = children.length;
    t.mock.timers.tick(delay - 1);
    assert.equal(children.length, count);
    t.mock.timers.tick(1);
    assert.equal(children.length, count + 1);
    assert.equal(c.state.status, "connecting");
    drop();
    await Promise.resolve();
  }
  t.mock.timers.tick(30000);
  ready();
  await Promise.resolve();
  assert.equal(c.state.status, "connected");
  assert.equal(
    children.at(-1).stdin.read(),
    null,
    "Never replay a failed save",
  );
  stale.stdout.write('{"event":"ready","home":"/stale"}\n');
  assert.equal(c.state.home, "/home/test");
  drop();
  assert.equal(c.state.retryDelay, 1000, "Success resets the backoff");
});

test("manual reconnect coalesces, Disconnect cancels both pending and active attempts", async (t) => {
  const { connection: c, children, ready, drop } = fixture(t);
  const initial = c.connect();
  ready();
  await initial;
  drop();
  const manual = c.connect();
  assert.strictEqual(c.connect(), manual);
  ready();
  await manual;
  t.mock.timers.tick(1000);
  assert.equal(children.length, 2, "Old retry timer was cancelled");
  drop();
  c.close();
  assert.equal(c.state.retryDelay, undefined);
  t.mock.timers.tick(60000);
  assert.equal(children.length, 2);
  const active = c.connect();
  const rejected = assert.rejects(active, /Disconnected/);
  c.close();
  await rejected;
  ready();
  t.mock.timers.tick(60000);
  assert.equal(c.state.status, "disconnected");
  assert.equal(children.length, 3);
});

test("authentication and host-key failures stop automatic attempts", async (t) => {
  const { connection: c, children, drop } = fixture(t);
  for (const error of [
    "Permission denied (publickey)",
    "Host key verification failed.",
  ]) {
    const attempt = c.connect();
    const rejected = assert.rejects(attempt);
    drop(error);
    await rejected;
    assert.equal(c.state.retryDelay, undefined);
    const count = children.length;
    t.mock.timers.tick(60000);
    assert.equal(children.length, count);
  }
});
