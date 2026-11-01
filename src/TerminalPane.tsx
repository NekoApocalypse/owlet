import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ConnectionState, TerminalEvent } from "./types";
export default function TerminalPane({
  root,
  connection,
  restart,
  onError,
}: {
  root: string;
  connection: ConnectionState;
  restart: number;
  onError(error: string): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState(false);
  const callback = useRef(onError);
  callback.current = onError;
  useEffect(() => {
    if (!root || connection.status !== "connected") return;
    let disposed = false,
      identifier: string | undefined;
    const early: TerminalEvent[] = [];
    const inputQueue: string[] = [];
    const sendInput = (data: string) => {
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
    fit.fit();
    const render = (event: TerminalEvent) => {
      if (event.terminal !== identifier) return;
      if (event.data)
        term.write(
          Uint8Array.from(atob(event.data), (character) =>
            character.charCodeAt(0),
          ),
        );
      if (event.event === "terminal-exit") {
        term.writeln(
          "\r\n\x1b[90m[Shell exited — use Restart terminal to open a new shell]\x1b[0m",
        );
        setEnded(true);
      }
    };
    const unsubscribe = window.lwr.onTerminal((event) => {
      if (identifier) render(event);
      else if (early.length < 100) early.push(event);
    });
    setEnded(false);
    window.lwr
      .startTerminal({ path: root, cols: term.cols, rows: term.rows })
      .then((id) => {
        identifier = id;
        if (disposed) {
          window.lwr.terminal("terminal-close", { terminal: id });
          return;
        }
        early.forEach(render);
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
          callback.current(String(error));
        }
      });
    const input = term.onData(sendInput);
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
      unsubscribe();
      if (identifier)
        window.lwr.terminal("terminal-close", { terminal: identifier });
      term.dispose();
    };
  }, [root, connection.status, restart]);
  return (
    <div
      className={`terminal-host ${ended ? "terminal-ended" : ""}`}
      data-testid="terminal"
    >
      <div className="terminal-mount" ref={host} />
    </div>
  );
}
