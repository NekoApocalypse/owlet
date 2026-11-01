# Owlet's command surface

Owlet is agent-native. The command palette is a first-class interface, alongside the file explorer, editor, preview, and terminal.
The same named actions are available to people and to in-process agent integrations:

```js
window.owletCommands.list() // IDs, titles, aliases, availability, and parameter hints
await window.owletCommands.execute('workspace.openSSH', { target: 'my-server', path: '/work/project' })
await window.owletCommands.execute('file.open', { path: 'C:/work/project/plan.md' })
await window.owletCommands.execute('editor.setText', { text: '# Revised plan\n' }) // unsaved
await window.owletCommands.execute('file.inspect', { readOnly: true })
await window.owletCommands.execute('workspace.state', { readOnly: true })
```

This API lives inside Owlet's renderer; it is not an unauthenticated network service. Markdown cannot invoke it.
Commands remain visible in the palette even when unavailable; disabled actions reject execution.
Commands that require a path, number, or text offer a prompt when invoked from the palette.

## UI coverage audit

| User action | Command coverage |
| --- | --- |
| Local folder, remote connection, new window, reload, close, minimize, maximize, fullscreen, application zoom | `workspace.openLocal`, `workspace.openSSH`, `window.*`, `view.zoom.*` |
| Open remote connection from the blue bottom-left icon or welcome screen | `workspace.openSSH`; searches for **remote**, **Open Remote**, and **SSH** find it |
| File menu, clean new window, search/open recent local or SSH windows, inspect/remove/clear history | `menu.file`, `window.newEmpty`, `workspace.openRecent`, `.recent`, `.removeRecent`, `.clearRecent`; recent IDs come from `workspace.recent({readOnly: true})` via the command registry |
| Explorer refresh, visibility, hidden files, expand/collapse a folder, load more entries, resize | `explorer.refresh`, `.toggle`, `.hidden`, `.expand`, `.toggleFolder`, `.collapseFolder`, `.collapse`, `.loadMore`, `.setWidth`, `.widen`, `.narrow` |
| Open, save, save all, close, revert, copy path, inspect unsaved text, compare changes | `file.open`, `.save`, `.saveAll`, `.close`, `.revert`, `.copyPath`, `.inspect`, `.compare` |
| Resolve a conflict or keep editing | `conflict.replace`, `.useRemote`, `.keepEditing`; replacement requires the compared revision and explicit confirmation |
| Vim, source focus, find, next/previous match, replacement, undo/redo, select all, replace unsaved buffer text | `editor.*`; search commands accept `search`, `replace`, `caseSensitive`, and `regexp` |
| Source/preview/both, resize their divider, follow file links, jump to a heading, open a web link | `markdown.source`, `.preview`, `.both`, `.toggle`, `.resize`, `.heading`, `file.open`, `link.openExternal` |
| Activate a tab/group, next/previous tab, split, move a tab, resize groups, equalize, close an empty group | `tab.activate`, `.next`, `.previous`, `group.focus`, `.next`, `.splitRight`, `.splitDown`, `.moveTab`, `.resize`, `.equalize`, `.closeEmpty` |
| Image fit and zoom | `image.fit`, `.zoomIn`, `.zoomOut` |
| Create/switch/rename/kill terminals, move into editor/panel, show/hide/focus, restart, resize, send text | `terminal.new`, `.select`, `.next`, `.previous`, `.rename`, `.close`, `.moveToEditor`, `.moveToPanel`, `.toggle`, `.focus`, `.restart`, `.start`, `.setHeight`, `.grow`, `.shrink`, `.sendText` |
| Expand Mermaid diagrams, fit/actual size, zoom, pan, close | `diagram.open`, `.fit`, `.actualSize`, `.zoomIn`, `.zoomOut`, `.zoom`, `.pan`, `.close` |
| Reconnect/disconnect, project color/import/reset/settings, notices, workspace inspection | `connection.*`, `project.*`, `message.dismiss`, `workspace.state` |
| Approve or cancel a pending destructive action | `confirmation.accept`, `.cancel`; approval requires the current question's token |

The audit added missing folder pagination/collapse, exact sizing, targeted tab/group navigation, source/preview resizing,
buffer inspection/editing, search actions, terminal input, link navigation, and confirmation commands. App-owned image,
terminal, tab, folder, connection, and resize controls now dispatch through the registry.

## Interaction boundary

Typing, IME composition, cursor movement, text selection, scrolling, hover, drag capture, and unsubmitted form drafts are
widget interactions, not separate palette entries for each event. CodeMirror owns its native editing/search controls and
keybindings; palette commands use the same editor operations. xterm input and `terminal.sendText` use the same input path.
Drag outcomes use sizing/move commands. Form submission uses the corresponding workspace, project, or path action.

Synchronous command changes commit before the command resolves, so consecutive calls use the latest selection.
Readiness and rendered state should still be observed for asynchronous work. Explorer loading and shell startup are asynchronous; terminal input rejects when the terminal
has not mounted or its shell has exited. Text sent by `terminal.sendText` is literal: a carriage return executes it in the shell.

## Confirmation contract

`file.revert`, closing a dirty file, and `terminal.restart` first show their existing confirmation. Read the pending question
from `workspace.state().confirmation`, then explicitly pass its `token` to `confirmation.accept`. Missing tokens only inspect
the question; stale tokens reject. This preserves the human UI's confirmation step. File conflicts separately require the
compared file revision. Agents must obtain the user's authorization where needed; an API token is not user consent.

## Maintaining coverage

Follow [AGENTS.md](../AGENTS.md). Before adding a control, identify its command and arguments. Keep titles searchable,
reuse the handler, and update this audit. `node tests/commands.cjs` checks behavior through the UI and API, including folder
pagination, unsaved editing, targeted navigation, confirmations, and remote-entry discovery. Set `OWLET_SSH_TARGET` to exercise
the connection form against a real host. Existing local, SSH, layout, and appearance tests cover the other command families.

`node tests/recent.cjs` checks File-menu command dispatch, recent-workspace UI, restart persistence, and local/SSH reopening.
The native File menu sends command IDs back to the renderer registry; it does not implement a second set of UI handlers.
`workspace.openRecent` and `.removeRecent` accept an `id` from the history list; omitting it opens a searchable picker.

## Terminals and diagrams

`workspace.state` includes `terminal.sessions` with stable IDs, names, locations, status, and the current PTY identifier.
`terminal.new` returns a terminal ID. Terminal commands accept an optional `id`; without one they use the selected terminal.
`terminal.sendText` never broadcasts to other shells. `terminal.select` without arguments opens a chooser.
`terminal.moveToEditor` accepts a destination `group`; terminal editor tabs also support `tab.activate` and `group.moveTab`.
`terminal.close` and `.restart` use the normal confirmation token flow for running shells. Moving terminals does not restart them.

`diagram.open` accepts a zero-based `index` and optional `group` containing a rendered preview. `diagram.zoom` accepts
`scale` (1 = 100%) or a relative `factor`, with optional canvas-pixel `x`/`y` anchor. `diagram.pan` accepts `dx`/`dy`.
`workspace.state().diagram` through the registry reports current scale and translation. The viewer uses already-sanitized SVG;
commands do not accept arbitrary SVG or HTML. Tests in `tests/terminal-workspaces.cjs` exercise these UI/API paths,
shell continuity, targeted input, real SSH reconnect, diagram navigation, and Find/Replace behavior and styling.

`tests/explorer-rename.cjs` verifies directory rename recovery locally and over SSH: obsolete subtree requests stop,
unsaved buffers survive, and a missing workspace root shows an inline notice instead of repeated error toasts.
