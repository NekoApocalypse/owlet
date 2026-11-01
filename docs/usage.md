# Use Owlet

## Open workspaces

Owlet starts in your local home directory. **Workspace: Open Local Folder** opens a native folder picker.
`Owlet.exe --local <path>` accepts a directory or a file. A file opens in its parent folder.

**Workspace: Connect over SSH** accepts an OpenSSH alias or `user@host` and an optional remote directory.
Establish a noninteractive connection and trust the host key in your normal SSH client first.
Aliases can supply ports, keys, and jump hosts. SSH workspaces require Bash and Python 3 on Linux.

Each window owns its workspace. Windows for the same SSH host share a connection. Disconnecting that host ends its direct
shells and preserves editor buffers; other hosts and local windows are unaffected. A remote multiplexer owns persistent
agent sessions. Local folders need neither SSH nor Python.

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

Hiding the terminal preserves it. **Restart Terminal** replaces it. **Reload Window** starts a new direct shell and prompts
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

Resolve authentication and host-key issues with your normal SSH client. The session helper needs a writable temporary
directory with 64 MiB free; set remote `OWLET_TMPDIR` to choose one. Normal shutdown removes the temporary directory;
a crash can leave temporary files. Saves still fail when the target volume is full.

Shell-profile errors remain visible. Owlet limits pyenv rehash retries to two seconds unless the host already sets
`PYENV_REHASH_TIMEOUT`. Other slow shell-profile commands can delay the terminal while files remain available.
