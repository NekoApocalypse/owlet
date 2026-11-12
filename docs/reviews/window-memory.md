# Reload restoration and recent commands

Reload Window restores the current window's tab order, active tabs and group, split layout, view modes, preview zoom,
and pane sizes. File contents are read again through the normal local/SSH backends. A deleted file remains a tab with
an inline error and Retry. Closing the original CLI-opened file before reload does not reopen it later.

Unsaved-change confirmation remains in place; cancel keeps the current renderer and buffers. Reload is blocked while
saves are in progress. Temporary unsupported-file tabs are omitted. Terminal tabs retain names, starting directories
and placement, but reload starts fresh shells; running processes and terminal scrollback are not recovered. This does
not add workspace recovery after quitting the app.

The command palette remembers the last 100 distinct commands chosen in the palette. Reusing one moves it to the front.
Recent commands rank first among matching search results. The queue persists in the user profile, shared by windows;
only command IDs are saved. Button, keyboard and API activity does not flood the queue with internal commands.
Preferences: Copy Recent Commands and Preferences: Clear Recent Commands expose history through the same command API.

Validation:
- `npm run build`
- `node --test tests/window-memory.test.cjs`
- `node tests/reload-history.cjs` locally and with a configured `OWLET_SSH_TARGET`
- Existing reader-preview and settings regression checks on the packaged build

Acceptance covers dirty cancellation/discard, fresh disk reads, missing files, PDF/image/Settings tabs, split and active
selection restoration, fresh terminal sessions without duplicates, repeated reload, empty windows, group-ID allocation,
SSH reconnect, window isolation, MRU ranking/deduplication, process restart persistence and clearing shared history.
