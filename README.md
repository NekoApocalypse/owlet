<p align="center"><img src="assets/icon.png" width="88" height="88" alt="Owlet"></p>

# Owlet

**A clearer view of your agents’ work.**

Your agents write the code. You review the plan, follow the reasoning, and decide what happens next.
Owlet gives you a familiar, VS Code-style file explorer, editor, and terminal—focused on that job.
Open a local folder or work over SSH, with rich Markdown and fast project switching.

![Owlet showing source and rich Markdown side by side](docs/images/workspace.png)

- **A project window in seconds.** Start reading while your agents keep working. Measured at **4.55 seconds** over a bandwidth-limited SSH connection; [test conditions](docs/performance.md).
- **Markdown you can think in.** Equations, Mermaid diagrams, images, and highlighted code. Switch between source and preview, or read both side by side.
- **Your familiar workspace.** File explorer, tabs, resizable splits, Vim mode, and a command palette. Keep the plan beside the implementation.
- **`owlet .` and you’re there.** Change directory in the integrated terminal and open another project window, just like `code .`.
- **Local or SSH. Same workflow.** Read files on your laptop or server. SSH uses your existing setup, with no persistent remote server to install.
- **Your edits stay yours.** Unsaved tabs get a dot. Agent changes refresh clean files; conflicting saves ask you to compare before replacing anything.
- **Recognize projects at a glance.** Give each window a Peacock-style color. Import a VS Code project color once, or choose your own.

## Getting Started

1. **Preferred: let your agent do it.** Copy this repository’s URL into your favorite coding agent—Claude Code, Codex, Antigravity, OpenCode—and ask it to build and launch Owlet.

2. **Build it yourself.** Windows x64 · Node.js 22.12+ · npm.

   ```sh
   npm ci
   npm run build
   npm run package
   ```

   Open `release/Owlet/Owlet.exe`. Use **Open Local Folder** or **Connect over SSH** in the command palette (`Ctrl+Shift+P`).

## Limitations

**Not yet:** macOS and Linux desktop builds, a signed installer, automatic updates, and interactive SSH password/MFA prompts.
Today’s build runs on Windows x64; SSH hosts need Linux, Bash, Python 3, and working noninteractive authentication.

**Out of scope:** Git UI, debugging, language servers, and an extension marketplace. Owlet is a fast, focused tool for viewing and editing your agents’ work, not an IDE.

**Current limits:** UTF-8 text up to 4 MiB; raster images up to 16 MiB. Owlet bundles Electron, so lightweight workflow does not mean a tiny download or memory footprint.

[Usage and configuration](docs/usage.md) · [Architecture and development](docs/development.md) · [Performance](docs/performance.md)
