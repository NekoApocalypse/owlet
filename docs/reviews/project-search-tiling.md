# Project search and editor tiling

Review build, based on the existing local review branch. No GitHub release or main-branch merge is included.

## What to try

1. Press **Ctrl+Shift+F**, type a keyword, then select a matching line. Try **Find in Folder…** from an Explorer folder's menu.
2. Use include/exclude fields to narrow the search. Set a small result cap in Settings to inspect the limited state and **Rerun with higher limits**.
3. Drag a file tab onto any pane edge. Drop in the center to move it into that group. Drag a terminal from the right-side list onto an editor edge.
4. Tile an unsaved file and a running terminal: the buffer stays dirty, and the shell keeps running.

## Implementation and limits

Search uses bundled local ripgrep or the SSH host's installed `rg`, with cancellation, timeout, result/byte/file-size bounds,
bounded remote batches and virtualized rows. No startup index or persistent daemon is added. Search reads saved text only;
this first version has no regex, replace-all, PDF extraction or OCR. Native glob/ignore behavior and configurable limits
are explained in [the command reference](../commands.md#project-text-search).

Tiling changes the existing split tree atomically through `group.tileTab`. It preserves dirty buffers, view modes,
terminal PTYs and xterm instances. Four edges create splits; center drops move tabs. It is confined to one Owlet window.

## Validation

- Production TypeScript/Vite build.
- Local and real-SSH search tests: scope, ignore rules, literal input, Unicode columns, depth, file size and result caps.
- Worker tests verify timeout/Stop terminate the actual child process and isolate concurrent windows.
- UI tests: shortcut/palette access, streamed and virtualized results, matching-line selection, dirty-buffer safety,
  folder context menu, rerunning limits and replacement of an in-flight query.
- Tiling UI tests: four edges, center moves, source collapse, native mouse drag, dirty text and terminal identity.
- Settings and existing terminal-workspace regressions.
- Rendered Search sidebar and drop-preview/workspace screenshots inspected.

The same focused checks are run against the portable package before updating the local launcher. Existing user windows
remain on their running build; new shortcut launches use the verified review build.
