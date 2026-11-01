# Use Owlet

## Open workspaces

Owlet starts in your local home directory. **Workspace: Open Local Folder** opens a native folder picker.
`Owlet.exe --local <path>` accepts a directory or a file. A file opens in its parent folder.

Click the blue remote icon at the bottom left, or run **Remote: Connect to Remote… (SSH)** from the command palette.
Searching for `remote`, `Open Remote`, or `SSH` finds this command. It accepts an OpenSSH alias or `user@host` and an optional remote directory.
Establish a noninteractive connection and trust the host key in your normal SSH client first.
Aliases can supply ports, keys, and jump hosts. SSH workspaces require Bash and Python 3 on Linux.

Each window owns its workspace. Windows for the same SSH host share a connection. Disconnecting that host ends its direct
shells and preserves editor buffers; other hosts and local windows are unaffected. A remote multiplexer owns persistent
agent sessions. Local folders need neither SSH nor Python.

## Return to recent work

The top-left **File** menu offers **New Window**, **Open Local Folder**, **Connect to Remote**, and **Open Recent**.
New Window (`Ctrl+Shift+N`) opens a clean welcome screen. Open Recent lists local folders and SSH folders together,
with the host shown beside each remote location. Choose **Recently Opened Windows…** to search the full list, or press
`Ctrl+Alt+R`. Selecting a workspace opens it in a new window.

Owlet remembers up to 50 successfully opened folders across restarts. The menu shows the latest 15; the searchable picker
shows all 50. History is saved in the laptop's Owlet profile, with no passwords or keys. Different SSH aliases remain
separate entries. History remembers folder locations, not tabs, unsaved buffers, or terminal sessions.

The palette also offers **Remove from Recently Opened** and **Clear Recently Opened**. These only change history;
they never delete folders. A moved local folder or an unavailable SSH host reports an error and stays in the list until removed.

## Startup options

Optional startup environment variables:

- `OWLET_SSH_TARGET`: start with this host instead of local mode.
- `OWLET_ROOT`: initial directory in the selected mode.
- `OWLET_USER_DATA`: separate application profile, useful for testing.
- `OWLET_SSH_PROXY`: an OpenSSH ProxyCommand, used by the bandwidth test.

Explicit `--local` and `--ssh` arguments take precedence. Legacy `LWR_*` names remain accepted; a corresponding nonempty
`OWLET_*` value takes precedence. No private host is built into the application.

## Use the terminal

Local terminals use Windows PowerShell and inherit the app's environment. Remote terminals use Bash and the remote shell
configuration. `owlet .` opens the terminal's current directory. A file argument opens that file.
The launcher lives in a temporary directory added only to the integrated shell's PATH.

An existing remote multiplexer can retain an old PATH and launcher socket. Start it from a new Owlet terminal or update
its PATH and `OWLET_SOCKET` from that terminal. Owlet does not modify your shell profiles.

Use **+** in the terminal toolbar for another shell (Ctrl+Shift plus backtick). When several terminals are in the panel, a list on
the right lets you switch between them. Double-click a terminal name to rename it, or use **Terminal: Rename Terminal**.

Use **Move terminal to editor** in the toolbar, or drag a terminal from the list into an editor group. It becomes a tab
alongside files, and can move between groups. Splitting a terminal tab moves that shell into the new group; it does not
duplicate the shell. **Move terminal to panel** brings it back. Moving, switching tabs, and hiding the panel preserve
the same shell, running processes, and scrollback. Hidden terminals continue receiving output.

**Kill Terminal** asks before ending a running shell; other terminals stay open. **Restart Terminal** replaces only the
selected shell. SSH disconnection ends that host's shells; after reconnecting, start each desired shell explicitly.
Terminals are not restored across application restarts, and there are no terminal profiles or terminal-pane split grids yet.
Use editor groups to place terminals side by side.

Hiding the terminal preserves it. **Reload Window** starts a new direct shell and prompts
before discarding unsaved edits. Do not reload a window if you need to preserve work running in its direct shell.

## Read and edit

- `Ctrl+Shift+P` or `F1` opens the command palette.
- `Ctrl+S` saves. Files are not saved automatically.
- `Ctrl+F` searches source. Syntax highlighting does not start a language server.
- `Ctrl+\` splits right. The palette offers Split Down and group navigation.
- Ctrl plus backtick toggles the terminal. `Ctrl+Shift+E` toggles the Explorer.
- Vim mode supports `:w`, `:q`, and `:wq` through the normal save and close safeguards.

Visible clean files are checked about every two seconds. Dirty files preserve their buffer. Saves compare a content revision
and use a same-directory temporary file. A changed file opens a comparison dialog. An unrelated writer can still race the
final replacement; this is conflict detection, not simultaneous collaborative editing.

Atomic saves follow symlinks but can change inode or hard-link relationships and do not preserve every filesystem attribute.
Permissions, Windows locks, network-drive failures, and full volumes produce errors without clearing unsaved edits.
UNC shares require access through the current Windows account and remain dependent on their network connection.

## Preview Markdown and images

Math supports `$...$` and `\(...\)` inline, plus `$$...$$` and `\[...\]` display blocks. Fenced `mermaid` blocks render
diagrams; other recognized fences receive syntax highlighting. Source and preview scroll independently.

Click **Expand** on a Mermaid diagram for a window-filling viewer. Drag to pan and scroll to zoom around the pointer.
The toolbar provides zoom, **100%**, and **Fit**; keyboard shortcuts are `+` / `-`, `1`, `0`, arrow keys, and `Esc`.
Double-click the canvas to fit again. The viewer is a snapshot of the rendered diagram; reopen it to see later Markdown edits.
Viewing and navigating a diagram never modifies the file. The command palette exposes these controls under **Diagram**.

- `./images/a.png` and `../images/a.png` resolve exactly relative to the Markdown file.
- `images/a.png` checks the document directory, then ancestors up to the project root. The nearest match wins.
- Absolute paths refer to the laptop in local mode and the server in SSH mode.
- Documents outside the root try their own directory and then the project root for unprefixed paths.

Owlet does not recursively search unrelated folders or fetch internet images automatically. Spaces, Unicode,
percent-encoded names, and reference-style image links are supported. Missing images list the attempted paths.

## Set project colors

Use **Project: Choose Window Color** or edit `.owlet/settings.json`:

```json
{
  "peacock.color": "#376b62"
}
```

One color drives the title bar, status bar, and accents. Text contrast is calculated automatically. Without a setting,
Owlet derives a stable color from the workspace location. Unrelated settings keys are preserved.

**Import Peacock Color from VS Code** reads the project's `.vscode/settings.json` once. Local mode imports `peacock.color`;
SSH mode prefers `peacock.remoteColor` and falls back to `peacock.color`. Neither reads VS Code settings automatically or
modifies them. Global settings and `.code-workspace` files are not imported.

Settings are limited to 16 KiB. Malformed or symlinked settings are rejected. Stale writes require a reload.
`.owlet` does not execute configuration or load plugins.

## Troubleshoot SSH

The explorer refreshes on window focus and with **Refresh Explorer**. If an agent renames or removes an expanded
directory, its obsolete subtree is removed and the parent listing refreshes. Open files and unsaved edits remain intact;
Owlet does not guess the new file paths. If the workspace root itself moves, an inline notice offers the next step.
Open its new location in another window, or refresh after restoring it.

Resolve authentication and host-key issues with your normal SSH client. The session helper needs a writable temporary
directory with 64 MiB free; set remote `OWLET_TMPDIR` to choose one. Normal shutdown removes the temporary directory;
a crash can leave temporary files. Saves still fail when the target volume is full.

Shell-profile errors remain visible. Owlet limits pyenv rehash retries to two seconds unless the host already sets
`PYENV_REHASH_TIMEOUT`. Other slow shell-profile commands can delay the terminal while files remain available.
