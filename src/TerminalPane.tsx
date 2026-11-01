import { useEffect, useLayoutEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ConnectionState, TerminalEvent, TerminalSession } from "./types";
export default function TerminalPane({
  root,
  connection,
  restart,
  id,
  destination,
  onStatus,
  onFocus,
  onError,
}: {
  root: string;
  connection: ConnectionState;
  restart: number;
  id: string;
  destination?: string;
  onStatus(status: TerminalSession["status"], pty?: string): void;
  onFocus(): void;
  onError(error: string): void;
}) {
  const parking = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const accepting = useRef(true);
  const callback = useRef({ onError, onStatus, onFocus, connection });
  callback.current = { onError, onStatus, onFocus, connection };
  // The React owner stays mounted. Only this imperative xterm surface moves;
  // moving between a panel and editor must never recreate the PTY or scrollback.
  useLayoutEffect(() => {
    if (!surface.current) {
      surface.current = document.createElement("div");
      surface.current.className = "terminal-host";
      surface.current.dataset.testid = "terminal";
      surface.current.dataset.terminalId = id;
      surface.current.addEventListener("focusin", () =>
        callback.current.onFocus(),
      );
      host.current = document.createElement("div");
      host.current.className = "terminal-mount";
      surface.current.appendChild(host.current);
    }
    const target = destination ? document.getElementById(destination) : null;
    const parent = target || parking.current!;
    if (surface.current.parentElement !== parent)
      parent.appendChild(surface.current);
  });
  useEffect(
    () => () => {
      surface.current?.remove();
    },
    [],
  );
  useEffect(() => {
    if (connection.status === "disconnected") {
      accepting.current = false;
      callback.current.onStatus("disconnected");
    }
  }, [connection.status]);
  useEffect(() => {
    if (!root) return;
    accepting.current = true;
    let disposed = false,
      exited = false,
      identifier: string | undefined;
    const early: TerminalEvent[] = [];
    const inputQueue: string[] = [];
    const sendInput = (data: string) => {
      if (
        !accepting.current ||
        disposed ||
        exited ||
        callback.current.connection.status !== "connected"
      )
        return;
      if (!identifier) {
        inputQueue.push(data);
        return;
      }
      const bytes = new TextEncoder().encode(data);
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      window.lwr.terminal("terminal-input", {
        terminal: identifier,
        data: btoa(binary),
      });
    };
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      lineHeight: 1.2,
      scrollback: 3000,
      theme: {
        background: "#002451",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selectionBackground: "#003f8e",
        black: "#111111",
        brightBlack: "#7285b7",
        red: "#ff9da4",
        brightRed: "#ff7882",
        green: "#d1f1a9",
        brightGreen: "#b8f171",
        yellow: "#ffeead",
        brightYellow: "#ffe580",
        blue: "#bbdaff",
        brightBlue: "#80baff",
        magenta: "#ebbbff",
        brightMagenta: "#d778ff",
        cyan: "#99ffff",
        brightCyan: "#78ffff",
        white: "#cccccc",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    if (host.current!.clientWidth && host.current!.clientHeight) fit.fit();
    const render = (event: TerminalEvent) => {
      if (event.terminal !== identifier) return;
      if (event.data)
        term.write(
          Uint8Array.from(atob(event.data), (character) =>
            character.charCodeAt(0),
          ),
        );
      if (event.event === "terminal-exit") {
        exited = true;
        term.writeln(
          "\r\n\x1b[90m[Shell exited — use Restart terminal to open a new shell]\x1b[0m",
        );
        callback.current.onStatus("exited", identifier);
      }
    };
    const unsubscribe = window.lwr.onTerminal((event) => {
      if (identifier) render(event);
      else if (early.length < 100) early.push(event);
    });
    callback.current.onStatus("starting");
    window.lwr
      .startTerminal({ path: root, cols: term.cols, rows: term.rows })
      .then((id) => {
        identifier = id;
        if (disposed) {
          window.lwr.terminal("terminal-close", { terminal: id });
          return;
        }
        early.forEach(render);
        if (!exited) callback.current.onStatus("running", id);
        inputQueue.splice(0).forEach(sendInput);
        // The panel may have resized while the SSH shell was starting.
        window.lwr.terminal("terminal-resize", {
          terminal: id,
          cols: term.cols,
          rows: term.rows,
        });
      })
      .catch((error) => {
        if (!disposed) {
          term.writeln(String(error));
          exited = true;
          callback.current.onStatus("error");
          callback.current.onError(String(error));
        }
      });
    const input = term.onData(sendInput);
    const commandInput = (event: Event) => {
      if (
        !accepting.current ||
        disposed ||
        exited ||
        callback.current.connection.status !== "connected"
      )
        return;
      const detail = (
        event as CustomEvent<{ id: string; text: string; accepted: boolean }>
      ).detail;
      if (detail.id !== id) return;
      detail.accepted = true;
      sendInput(detail.text);
    };
    window.addEventListener("owlet-terminal-input", commandInput);
    const focus = (event: Event) => {
      if ((event as CustomEvent).detail.id === id) term.focus();
    };
    window.addEventListener("owlet-terminal-focus", focus);
    const observer = new ResizeObserver(() => {
      if (disposed || !host.current?.clientWidth || !host.current.clientHeight)
        return;
      fit.fit();
      if (identifier)
        window.lwr.terminal("terminal-resize", {
          terminal: identifier,
          cols: term.cols,
          rows: term.rows,
        });
    });
    observer.observe(host.current!);
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      window.removeEventListener("owlet-terminal-input", commandInput);
      window.removeEventListener("owlet-terminal-focus", focus);
      unsubscribe();
      if (identifier)
        window.lwr.terminal("terminal-close", { terminal: identifier });
      term.dispose();
    };
  }, [id, root, restart]);
  return <div ref={parking} style={{ display: "none" }} aria-hidden="true" />;
}
