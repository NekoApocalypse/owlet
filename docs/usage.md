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
- `Ctrl+F` searches the focused source editor or Markdown preview. Syntax highlighting does not start a language server.
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

## Preferences

Click the **gear** in the title bar, press `Ctrl+,`, or run **Preferences: Open Settings**.
Settings opens as an ordinary editor tab: split it beside a document, search for `font`, and switch between **UI** and **JSON**.
Both modes share the same unsaved buffer. **Save** (`Ctrl+S`) applies changes; closing a dirty tab asks before discarding them.

Settings cover source and preview font size/family/line spacing, source word wrap and Vim mode, the initial Markdown view,
and terminal font size/family/line spacing/scrollback. Fonts must already be installed. Terminal appearance changes keep the
running shell. Reset beside a setting removes its override; Save applies the default.

User preferences live in `settings.json` inside Owlet's local application profile (normally `%APPDATA%/Owlet` on Windows).
The Settings tab shows the exact path. This file is local even in SSH windows, and saved changes reach other windows within
about two seconds. It accepts JSON with comments and trailing commas. Unknown keys are preserved but ignored; recognized keys
have checked types and bounds. Invalid files keep the last valid preferences until corrected. Save detects disk conflicts.
Project colors remain in the project's `.owlet/settings.json`; font preferences do not yet have project overrides.

Example:

```jsonc
{
  "editor.fontSize": 15,
  "editor.wordWrap": true,
  "editor.vimMode": true,
  "preview.fontSize": 17,
  "terminal.fontSize": 14,
  "markdown.defaultView": "preview"
}
```

## Find and zoom in previews

Press `Ctrl+F` inside a Markdown preview to search its visible prose, headings, inline code, and code blocks.
`Enter` / `Shift+Enter` move through matches; `Esc` closes find. This is literal, case-insensitive search, scoped to that pane.
Equations and Mermaid diagrams are excluded. Use Source mode to search their source. There is no preview replacement or regex
search; results are capped at 1,000 per pane. New file contents refresh the results without editing the file.

Inside a preview, `Ctrl++` (also `Ctrl+=`), `Ctrl+-`, and `Ctrl+wheel` zoom the rendered content from 50% to 300%.
`Ctrl+0` or the percentage badge resets it. All previews in that window share the zoom, including previews opened later.
The surrounding UI, source editors, and terminals stay at their own sizes. Preview zoom resets when the window reloads;
use the saved preview font size preference for a lasting reading size.

## Quick Open and file actions

Press **Ctrl+P** to find files by fuzzy name or relative path. Results are usable while the footer says **Indexing…**.
Owlet scans directory metadata in the background, one page at a time, after the initial workspace load; file contents are not
indexed. `files.quickOpenMaxDepth` in Settings defaults to 5 (0 means root files only; maximum 20). The index skips `.git`,
`node_modules`, `.venv`, `__pycache__`, and symlink directories. It stops at 20,000 files, 5,000 queued folders, or 10,000 listing
pages and labels a capped/error result as partial. Refresh with the Quick Open refresh button; reopening after 15 seconds
also refreshes while keeping existing results usable. It is not a continuously watched filesystem-wide search.

Right-click an Explorer item or file tab for **New File**, **New Folder**, **Cut**, **Copy**, **Paste**, **Copy Path**, **Copy Relative Path**, **Rename**, and
**Delete**. SSH file menus also offer **Download**. New items are created beside the clicked file or inside the clicked folder.
Cut/Copy/Paste uses a file clipboard within the current Owlet window. Cut dims the item until a confirmed Paste moves it;
Copy duplicates a regular file or folder. Pasting a copy beside itself chooses a new "copy" name. The destination must otherwise
be absent. Changed sources require copying/cutting again. Folder copies reject symbolic links and stop at 20,000 items.
The file clipboard clears on reload or workspace change; it does not replace the OS text clipboard or transfer across windows.
With an Explorer row focused, Ctrl+X/C/V uses these file actions; source editors keep their normal text shortcuts.

Dragging an Explorer item onto a folder proposes a move; dragging a file into an editor group opens it there.

Drop files from Windows File Explorer into the Explorer to copy them locally or upload them to an SSH folder. Drops onto a
file use its parent folder; empty Explorer space uses the workspace root. A highlighted folder shows the destination.
Folder and symbolic-link uploads are not supported yet. At most 100 regular files can be selected; transfers stream in
16 KiB chunks and never replace an existing filename. A failed batch keeps already completed files and reports that count.
Download uses a local Save As dialog; existing-file replacement requires that dialog's confirmation.

Moves and deletes require confirmation, reject stale file metadata, and refuse dirty open files. Clean open tabs follow
moves made through Owlet. Delete is permanent, including a folder's contents; it does not use the Recycle Bin. The workspace
root cannot be moved or deleted. If new edits arrive during a remote delete, their buffer stays open as a missing file.
External agent renames still leave open tabs at their original paths. Existing terminals keep their shell working directory;
file moves do not restart shells or change their directory. Local moves currently require Windows; remote moves require
Linux with `renameat2`. No overwrite, recursive upload, cross-workspace drag, drag reordering, or multi-selection is included.

## Everyday Vim

Enable Vim in Settings or from the command palette. The Vim command line uses the source editor's font size.

- Search with `/` or `?`; repeat with `n` / `N`, search a word with `*` / `#`, clear highlights with `:noh`.
- Substitute with `:s/old/new/`, `:%s/old/new/g`, ranges, and confirmation (`c`). Undo/redo use `u` / `Ctrl+R` or `:undo` / `:redo`.
- Save with `:w`, save only if changed with `:up`, save all dirty tabs with `:wa`.
- Reload a clean file with `:e`; explicitly discard and reload with `:e!`. A failed read keeps the buffer.
- `:wq`, `:x`, and `:exit` save before closing. `:q` uses Owlet's normal dirty-tab confirmation.

Host commands operate on existing tabs: filenames, ranges on writes, shell commands, and full Vim UI/window management are
not added. `:w!` does not bypass Owlet's conflict checks; `:q!` retains the normal discard confirmation. Search/substitution
use CodeMirror Vim's regex behavior, not every Vim regex feature.
