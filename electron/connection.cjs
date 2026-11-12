const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { deflateSync } = require("node:zlib");

class Connection extends EventEmitter {
  constructor(target, { spawnProcess = spawn } = {}) {
    super();
    if (
      typeof target !== "string" ||
      !/^[a-z\d_][a-z\d_.@:\[\]-]*$/i.test(target)
    )
      throw new Error("Enter an SSH host alias or user@host");
    this.kind = "ssh";
    this.target = target;
    this.spawnProcess = spawnProcess;
    this.stopped = true;
    this.retryAttempt = 0;
    this.pending = new Map();
    this.counter = 0;
    this.state = { kind: "ssh", status: "disconnected", target, shell: "Bash" };
    this.metrics = {
      sent: 0,
      received: 0,
      bootstrap: 0,
      controlSent: 0,
      controlReceived: 0,
    };
    this.bulkQueues = [Promise.resolve(), Promise.resolve()];
    this.bulkCursor = 0;
  }
  connect() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.connecting) return this.connecting;
    if (this.state.status === "connected") return Promise.resolve(this.state);
    this.state = {
      kind: "ssh",
      status: "connecting",
      target: this.target,
      shell: "Bash",
      retryAttempt: this.retryAttempt,
    };
    this.emit("state", this.state);
    this.connecting = new Promise((resolve, reject) => {
      const script = deflateSync(
        Buffer.concat([
          readFileSync(path.join(__dirname, "../remote/search.py")),
          Buffer.from("\n"),
          readFileSync(path.join(__dirname, "../remote/bridge.py")),
        ]),
      ).toString("base64");
      const command = `python3 -u -c "import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('${script}')),'<lwr>','exec'))"`;
      this.metrics.bootstrap = Buffer.byteLength(command);
      const extra = process.env.LWR_SSH_PROXY
        ? ["-o", `ProxyCommand=${process.env.LWR_SSH_PROXY}`]
        : [];
      const child = this.spawnProcess(
        "ssh",
        [
          "-T",
          "-C",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=2",
          ...extra,
          this.target,
          command,
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.child = child;
      let buffer = "";
      let stderr = "";
      let ready = false;
      let closed = false;
      const timeout = setTimeout(() => {
        child.kill();
        finish("Connection timed out");
      }, 25000);
      const finish = (message) => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        child.kill();
        this.connecting = null;
        this.child = null;
        this.stopAttempt = null;
        // Authentication/host-key/configuration errors require user attention.
        // Retrying them indefinitely cannot repair the connection.
        const permanent =
          /permission denied|host key verification failed|remote host identification has changed|bad configuration option|bad owner or permissions|invalid (?:user|configuration)|ssh.*ENOENT|python3:.*(?:not found|No such file)/i.test(
            message,
          );
        const retryDelay =
          !this.stopped && !permanent
            ? Math.min(1000 * 2 ** Math.min(this.retryAttempt++, 5), 30000)
            : undefined;
        if (retryDelay) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.connect().catch(() => {});
          }, retryDelay);
          this.retryTimer.unref?.();
        }
        this.state = {
          kind: "ssh",
          shell: "Bash",
          status: "disconnected",
          target: this.target,
          error: message,
          retryDelay,
          retryAttempt: this.retryAttempt,
        };
        this.emit("state", this.state);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(message));
        }
        this.pending.clear();
        if (!ready) reject(new Error(message));
      };
      this.stopAttempt = () => {
        child.stdin.end();
        child.kill();
        finish("Disconnected");
      };
      child.stderr.on("data", (data) => {
        stderr = (stderr + data.toString()).slice(-4000);
      });
      child.on("error", (error) => finish(error.message));
      child.on("exit", (code) =>
        finish(stderr.trim() || `SSH connection closed (${code ?? "signal"})`),
      );
      child.stdin.on("error", (error) => finish(error.message));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (closed) return;
        this.metrics.received += Buffer.byteLength(chunk);
        buffer += chunk;
        if (buffer.length > 32 * 1024 * 1024) {
          child.kill();
          finish("Oversized response");
          return;
        }
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.event === "ready") {
            this.metrics.controlReceived += Buffer.byteLength(line) + 1;
            clearTimeout(timeout);
            ready = true;
            this.retryAttempt = 0;
            this.connecting = null;
            this.state = {
              kind: "ssh",
              shell: "Bash",
              status: "connected",
              target: this.target,
              home: message.home,
              socket: message.socket,
            };
            this.emit("state", this.state);
            resolve(this.state);
          } else if (message.id) {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            const control =
              pending.method === "file-chunk"
                ? { ...message, result: {} }
                : pending.method === "list" && message.result
                  ? {
                      ...message,
                      result: { ...message.result, entries: undefined },
                    }
                  : message;
            this.metrics.controlReceived +=
              Buffer.byteLength(JSON.stringify(control)) + 1;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error));
            else pending.resolve(message.result);
          } else if (message.event) {
            if (message.event !== "terminal-data")
              this.metrics.controlReceived += Buffer.byteLength(line) + 1;
            this.emit("remote-event", message);
          }
        }
      });
    });
    return this.connecting;
  }
  request(method, args = {}) {
    if (this.state.status !== "connected" || !this.child)
      return Promise.reject(new Error("SSH is disconnected"));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote ${method} timed out`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer, method });
      const line = JSON.stringify({ id, method, args }) + "\n";
      this.metrics.sent += Buffer.byteLength(line);
      this.metrics.controlSent +=
        Buffer.byteLength(
          JSON.stringify({
            id,
            method,
            args: method === "save" ? { ...args, text: undefined } : args,
          }),
        ) + 1;
      this.child.stdin.write(line);
    });
  }
  notify(method, args) {
    if (this.state.status === "connected" && this.child) {
      const line = JSON.stringify({ method, args }) + "\n";
      this.metrics.sent += Buffer.byteLength(line);
      if (method !== "terminal-input")
        this.metrics.controlSent += Buffer.byteLength(line);
      this.child.stdin.write(line);
    }
  }
  async download(args, image = false, pdf = false) {
    const meta = await this.request(
      pdf ? "pdf-open" : image ? "image-open" : "read-open",
      args,
    );
    const chunks = [];
    try {
      let offset = 0;
      const enqueue = () => {
        const start = offset;
        offset += 8192;
        // Two bounded bulk chunks globally; control and metadata bypass these queues.
        const slot = this.bulkCursor++ % this.bulkQueues.length;
        const next = this.bulkQueues[slot].then(() =>
          this.request("file-chunk", { token: meta.token, offset: start }),
        );
        this.bulkQueues[slot] = next.catch(() => {});
        return next.catch((error) => ({ error }));
      };
      const pending = [];
      while (pending.length < 2 && offset < meta.size) pending.push(enqueue());
      while (pending.length) {
        const result = await pending.shift();
        if (result.error) throw result.error;
        chunks.push(Buffer.from(result.data, "base64"));
        if (offset < meta.size) pending.push(enqueue());
      }
      const data = Buffer.concat(chunks);
      if (data.length !== meta.size)
        throw new Error("Incomplete file transfer");
      if (pdf)
        return {
          path: meta.path,
          stamp: meta.stamp,
          data: data.toString("base64"),
        };
      if (image)
        return {
          path: meta.path,
          url: `data:${meta.mime};base64,${data.toString("base64")}`,
          stamp: meta.stamp,
        };
      return {
        path: meta.path,
        text: data.toString("utf8"),
        revision: meta.revision,
        stamp: meta.stamp,
      };
    } finally {
      this.notify("file-release", { token: meta.token });
    }
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
    if (this.stopAttempt) this.stopAttempt();
    else {
      this.state = {
        ...this.state,
        status: "disconnected",
        retryDelay: undefined,
        retryAttempt: 0,
      };
      this.emit("state", this.state);
    }
  }
}
module.exports = { Connection };
