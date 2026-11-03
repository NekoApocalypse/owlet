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
| Welcome Start actions and inline local/SSH Recents | `window.openFolder`, `workspace.openSSH`, `file.quickOpen`, `terminal.focus`, `commands.show`, `workspace.openRecent({id})`; Open Recent without an ID opens the full picker |
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

`project.color.set({color?: "#RRGGBB", revision?: string | null})` opens the window-color picker when
called without a color. Its saturation/brightness square, hue slider, HSB/HEX fields and default palette
edit a local draft with live title/status-bar preview. Save uses this same command with the revision
observed when the picker opened; Cancel/Escape discard the draft. No settings writes or SSH requests
are made by dragging or typing. Explicit color arguments save directly through the same validation and
conflict checks. `project.color.reset` restores the automatic color; `project.settings.get` reports the
persisted color (not an unsubmitted preview). The single `peacock.color` setting remains unchanged.
The square supports arrow keys (Shift for steps of ten); all channels also have numeric inputs.
`tests/color-picker.cjs` covers synchronization, pointer/keyboard controls, previews, cancellation,
persistence and stale-save rejection.

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

## Preview reading and preferences

`file.open({path, group?})` creates a temporary read-only Unsupported file tab for binary/encoding/size-limit failures and
unreadable PDF/image content. `file.inspect({readOnly:true})` exposes its `unsupported` reason. Explorer reveals and focuses
the selected file; normal supported-file activation retains the existing focus behavior. Navigation through `file.open`,
`tab.activate`, `group.focus`, or terminal focus automatically dismisses the temporary tab when it loses its active context.
The same lifecycle applies to mouse/keyboard navigation; no separate button-only action exists. Unsupported views do not
poll/re-read their contents, cannot be edited or saved, and are not retained after dismissal.

PDF files open through `file.open({path, group?})`. The viewer controls and command palette share
`pdf.nextPage`, `pdf.previousPage`, `pdf.page({page, group?})` (1-based; omitted page prompts),
`pdf.zoomIn`, `pdf.zoomOut`, `pdf.actualSize`, `pdf.fitWidth`, and `pdf.copyPageText`.
Every PDF command accepts optional `group` (default: focused group). `pdf.state({group?})` returns the current path,
page/count, zoom (`"fit"` or a scale), render state, error and current-page text. Each split pane has independent controls.
PDF text selection uses the existing `preview.copy` command and Copy context menu. PageUp/PageDown and Ctrl++/Ctrl+-/Ctrl+0
work when the PDF page has focus; Ctrl+wheel zooms the hovered PDF pane. These are read-only viewers; text-editing commands are unavailable.

Tab middle-click uses `file.close({path, group})`, preserving unsaved-buffer and terminal-close confirmation.
Tabs have their own menu. `group.splitRight({group?, path?})` and `group.splitLeft({group?, path?})` split the targeted tab;
`tab.reveal({group?, path?})` shows its Explorer row, opening the sidebar if needed.
`tab.closeSaved()` closes all clean document tabs across the window, leaving dirty buffers, in-progress saves and terminal
tabs open. Copy Path and Copy Relative Path reuse the file commands; filesystem operations remain in the Explorer menu.

`connection.reconnect()` immediately connects or joins the active SSH attempt; it cancels a pending automatic retry timer.
`connection.disconnect()` stops automatic retries and ends that host's direct shells, including while connecting or waiting
to retry. Windows on the same host share one retry loop. Transient connection loss uses capped exponential backoff;
failed writes are never replayed. `workspace.state({readOnly:true}).connectionDetails` exposes `retryDelay` (milliseconds while
waiting) and `retryAttempt` alongside the existing status/error fields.

Text context menus use `editor.cut`, `editor.copy`, and `editor.paste` with `{group?, path?}` (path guards against a changed tab),
and `preview.copy({group?, text?})`. Omit arguments to use the active pane's selection. Preview `text` is an optional selection
snapshot captured before menu focus changes. These commands use the system text clipboard independently of Vim registers.
Cut/Paste change only the unsaved source buffer and remain undoable. They reject a changed editor while clipboard access is pending.

| Action | Command and arguments |
| --- | --- |
| Find literal preview text | `preview.find({group?, search?})`; omitted search focuses/reopens the pane's query; at most 512 characters |
| Navigate/close/inspect preview find | `preview.findNext`, `.findPrevious`, `.closeFind`, `.findState`, each accepting `{group?}`; state returns `open`, `search`, `matches`, `current`, `limited` |
| Shared window-session preview zoom | `preview.zoom.in`, `.out`, `.reset`; `workspace.state` returns `previewZoom` |
| Open Settings UI / JSON | `settings.open({group?})`, `settings.json({group?})`; both use the same `owlet://user/settings.json` buffer |
| Edit one setting / remove its override | `settings.update({key, value})`, `settings.reset({key})`; these edit the buffer without saving; omit key to open the UI |
| Apply preferences | `settings.save`; `file.save({path: "owlet://user/settings.json"})` is equivalent and preserves conflict checks |
| Inspect effective preferences and schema | `settings.inspect`; returns local disk `path`, effective `values`, and typed `definitions` with defaults/bounds |

`Ctrl++` / `Ctrl+=`, `Ctrl+-` (including numpad plus/minus), and `Ctrl+0` route to these zoom commands when a preview is
focused or active after a tab/Explorer click. Source editors, terminals and modal inputs retain their own shortcuts.
Ctrl+wheel inside a preview uses the same shared zoom commands.

Settings JSON can also be edited via `editor.setText` and inspected through `file.inspect`. Unknown keys/comments survive
individual UI edits. Invalid known values cannot be saved. `editor.vim` now persists the toggle in user settings; it asks you
to finish unsaved Settings edits first so a shortcut cannot silently save unrelated edits. Direct text entry and settings
search remain widget interactions; their submitted changes use the same commands as agent calls.

## Quick Open, files, and Vim

| Action | Command and arguments |
| --- | --- |
| Fuzzy Quick Open / inspect results | `file.quickOpen({query?})` (Ctrl+P); `file.search({query, limit?})` returns `matches`, `loading`, `limited`, `errors`, `indexed`; omit query to open the picker |
| Restart background index | `file.index.refresh`; depth is controlled by `files.quickOpenMaxDepth` |
| Create | `file.newFile({directory?, name?})`, `file.newFolder({directory?, name?})`; omitted name prompts |
| File clipboard | `file.cut({path?})`, `file.copy({path?})`, `file.paste({directory?})`; `workspace.state().fileClipboard` reports the current item; Cut/Paste confirms a move |
| Copy path | `file.copyPath({path?})`, `file.copyRelativePath({path?})`; default is the current file |
| Rename / move | `file.rename({path?, name?})`, `file.move({path?, directory?, destination?})`; a directory retains the basename, destination is a complete path; omitted destination/name prompts |
| Delete | `file.delete({path?})`; deletion is permanent and always confirms |
| Copy/upload local files | `file.import({directory?, paths?})`; paths are absolute local regular files; omission opens a native picker |
| Download from SSH | `file.download({path?, destination?})`; omit destination for Save As; explicit destination must not exist |
| Reload current/open file | `file.reload({path?, discard?})`; refuses dirty buffers unless discard is explicitly true; `file.revert` presents a confirmation first |
| Execute a Vim Ex command | `editor.vimCommand({command?})`; omit for a prompt; requires Vim enabled and a source editor; host operations return a completion boolean |

Context menus and drag outcomes dispatch these same commands. Move, rename, and delete return a pending confirmation;
use `workspace.state().confirmation` and `confirmation.accept({token})`. Neither API calls nor dragging bypass the dirty
buffer, revision, workspace-boundary, or no-overwrite checks. Import/download streams stay in the main process, outside the
renderer. Direct typing, drag capture, menu navigation, and fuzzy query editing remain widget interactions.

`tests/vim-files.cjs`, `tests/remote-files-ui.cjs`, and `tests/file-operations.test.cjs` cover these paths. The SSH checks need
`OWLET_SSH_TARGET` and optionally `OWLET_TEST_TMPDIR`; they use dedicated test directories.
