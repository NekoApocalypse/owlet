import {
  FolderOpen,
  Wifi,
  Search,
  TerminalSquare,
  Command,
} from "lucide-react";
import { basename, type RecentWorkspace, type ConnectionState } from "./types";

export default function Welcome({
  logo,
  recent,
  workspaceReady,
  hasWorkspace,
  connection,
  execute,
}: {
  logo: string;
  recent: RecentWorkspace[];
  workspaceReady: boolean;
  hasWorkspace: boolean;
  connection: ConnectionState;
  execute(id: string, args?: Record<string, unknown>): void;
}) {
  const unavailable = hasWorkspace
    ? "Reconnect to search files and use the terminal."
    : "Open a folder to search files and use its terminal.";
  const actions = [
    { label: "Open Folder", icon: FolderOpen, command: "window.openFolder" },
    { label: "Connect Remote", icon: Wifi, command: "workspace.openSSH" },
    {
      label: "Search File",
      icon: Search,
      command: "file.quickOpen",
      shortcut: "Ctrl+P",
      needsWorkspace: true,
    },
    {
      label: "Open Terminal",
      icon: TerminalSquare,
      command: "terminal.focus",
      shortcut: "Ctrl+`",
      needsWorkspace: true,
    },
    {
      label: "Command Palette",
      icon: Command,
      command: "commands.show",
      shortcut: "Ctrl+Shift+P",
    },
  ];
  return (
    <div className="welcome" aria-label="Welcome to Owlet">
      <div className="welcome-content">
        <header className="welcome-brand">
          <img className="welcome-logo" src={logo} alt="" />
          <div>
            <h1>Owlet</h1>
            <p>Less between you and your work</p>
          </div>
        </header>
        {connection.kind === "ssh" && connection.status !== "connected" && (
          <div
            className="welcome-connection"
            role={connection.status === "connecting" ? "status" : "alert"}
          >
            <strong>
              {connection.status === "connecting"
                ? `Connecting to ${connection.target}…`
                : `SSH connection unavailable: ${connection.target}`}
            </strong>
            {connection.status === "connecting" ? (
              <span>Waiting for SSH before loading the remote folder.</span>
            ) : (
              <>
                <span>
                  {connection.error || "The connection was closed."}
                  {connection.retryDelay
                    ? ` Retrying automatically in ${connection.retryDelay / 1000}s.`
                    : ""}
                </span>
                <button onClick={() => execute("connection.reconnect")}>
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
        <div className="welcome-sections">
          <section className="welcome-start" aria-label="Start">
            <h2>Start</h2>
            {actions.map(
              ({ label, icon: Icon, command, shortcut, needsWorkspace }) => (
                <button
                  key={command}
                  className="welcome-action"
                  aria-label={label}
                  disabled={needsWorkspace && !workspaceReady}
                  title={
                    needsWorkspace && !workspaceReady ? unavailable : undefined
                  }
                  onClick={() => execute(command)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                  {shortcut && <kbd>{shortcut}</kbd>}
                </button>
              ),
            )}
            {!workspaceReady && <p className="welcome-empty">{unavailable}</p>}
          </section>
          <section className="welcome-recents" aria-label="Recent workspaces">
            <h2>Recents</h2>
            {recent.length ? (
              <ul>
                {recent.slice(0, 6).map((entry) => {
                  const location =
                    entry.kind === "ssh" ? `SSH: ${entry.target}` : "Local";
                  const Icon = entry.kind === "ssh" ? Wifi : FolderOpen;
                  return (
                    <li key={entry.id}>
                      <button
                        className="welcome-recent"
                        title={`${location} · ${entry.path}`}
                        aria-label={`Open ${basename(entry.path)} — ${location} — ${entry.path}`}
                        onClick={() =>
                          execute("workspace.openRecent", { id: entry.id })
                        }
                      >
                        <Icon size={14} aria-hidden="true" />
                        <span className="welcome-recent-detail">
                          <span className="welcome-recent-name">
                            {basename(entry.path)}
                          </span>
                          <span className="welcome-recent-path" dir="rtl">
                            <bdi dir="ltr">{entry.path}</bdi>
                          </span>
                        </span>
                        <span className="welcome-recent-location">
                          {location}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="welcome-empty">
                Your recent local and remote workspaces will appear here.
              </p>
            )}
            {recent.length > 0 && (
              <button
                className="welcome-more"
                onClick={() => execute("workspace.openRecent")}
              >
                Open Recent…
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
