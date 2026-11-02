export type RecentWorkspace = {
  id: string;
  kind: "local" | "ssh";
  path: string;
  target?: string;
};
export type ConnectionState = {
  kind?: "local" | "ssh";
  shell?: string;
  status: "connected" | "connecting" | "disconnected";
  target: string;
  home?: string;
  error?: string;
};
export type Entry = {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
};
export type RemoteFile = {
  path: string;
  text: string;
  revision: string;
  stamp: string;
};
export type Document = RemoteFile & {
  saved: string;
  mode: "source" | "preview" | "both";
  image?: string;
  conflict?: RemoteFile;
  missing?: boolean;
  lineEnding?: string;
};
export type Group = { id: number; tabs: string[]; active?: string };
export type Layout =
  | { kind: "group"; group: Group }
  | {
      kind: "split";
      id: number;
      axis: "row" | "column";
      ratio: number;
      first: Layout;
      second: Layout;
    };
export type TerminalEvent = {
  event: string;
  terminal: string;
  data?: string;
  status?: number;
};
export type TerminalSession = {
  id: string;
  name: string;
  path: string;
  location: "panel" | "editor";
  restart: number;
  status: "starting" | "running" | "exited" | "disconnected" | "error";
  pty?: string;
};
declare global {
  interface Window {
    lwr: {
      droppedPaths(files: File[]): string[];
      importFiles(args: {
        directory: string;
        paths?: string[];
      }): Promise<{ paths: string[] } | null>;
      downloadFile(args: {
        path: string;
        destination?: string;
      }): Promise<{ path: string } | null>;
      readSettings(): Promise<RemoteFile>;
      saveSettings(args: {
        text: string;
        revision: string;
      }): Promise<RemoteFile>;
      bootstrap(): Promise<{
        root?: string;
        file?: string;
        connection: ConnectionState;
      }>;
      connect(): Promise<ConnectionState>;
      disconnect(): Promise<void>;
      remote<T = any>(
        method: string,
        args: Record<string, unknown>,
      ): Promise<T>;
      openWindow(root: string): Promise<void>;
      openLocal(root?: string): Promise<boolean>;
      openSSH(target: string, root?: string): Promise<void>;
      newWindow(): Promise<void>;
      fileMenu(): Promise<void>;
      recent(): Promise<RecentWorkspace[]>;
      openRecent(id: string): Promise<void>;
      removeRecent(id: string): Promise<RecentWorkspace[]>;
      clearRecent(): Promise<RecentWorkspace[]>;
      onRecent(fn: (entries: RecentWorkspace[]) => void): () => void;
      onCommand(
        fn: (command: { id: string; args: Record<string, unknown> }) => void,
      ): () => void;
      onConnection(fn: (state: ConnectionState) => void): () => void;
      startTerminal(args: {
        path: string;
        cols: number;
        rows: number;
      }): Promise<string>;
      terminal(method: string, args: Record<string, unknown>): void;
      onTerminal(fn: (event: TerminalEvent) => void): () => void;
      dirty(value: boolean): void;
      external(url: string): Promise<void>;
      reload(): Promise<boolean>;
      closeWindow(): Promise<void>;
      zoom(direction: "in" | "out" | "reset"): Promise<void>;
      fullscreen(): Promise<void>;
      appearance(value: {
        color: string;
        foreground: string;
        title: string;
      }): Promise<void>;
      windowAction(action: "minimize" | "maximize"): Promise<void>;
    };
  }
}
export const basename = (path: string) =>
  path.replaceAll("\\", "/").split("/").filter(Boolean).pop() || "/";
export const dirname = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  const parent = normalized.slice(0, normalized.lastIndexOf("/"));
  return /^[a-z]:$/i.test(parent) ? parent + "/" : parent || "/";
};
export const isMarkdown = (path: string) =>
  /\.(md|markdown|mdown)$/i.test(path);
export const isImage = (path: string) =>
  /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(path);
export function resolvePath(base: string, relative: string) {
  base = base.replaceAll("\\", "/");
  relative = relative.replaceAll("\\", "/");
  const absolute = /^(?:[a-z]:\/|\/)/i.test(relative);
  let full = absolute ? relative : `${base}/${relative}`;
  const drive = full.match(/^[a-z]:/i)?.[0];
  const unc = !drive && full.startsWith("//");
  if (drive) full = full.slice(2);
  const parts: string[] = [];
  for (const part of full.split("/")) {
    if (part === "..") {
      if (parts.length > (unc ? 2 : 0)) parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return (drive ? drive + "/" : unc ? "//" : "/") + parts.join("/");
}
