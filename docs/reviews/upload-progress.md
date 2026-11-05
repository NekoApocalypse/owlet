# Visible upload progress

Dropping local files into an SSH workspace now immediately shows their names in Explorer and opens a compact bottom-right
upload popup. The destination branch expands, and pending rows use the same height and indentation as normal files.
The popup shows queued state, confirmed byte progress, completion, and per-file errors. Files remain temporary until the
existing no-overwrite commit succeeds.

- Hide in the popup header leaves the queue running. The Transfers status-bar button and command palette reopen it.
- Each pending file has a stop action. Queued files skip immediately; active files stop after their outstanding request
  settles and remove their temporary upload. Other files continue. Finalizing a completed transfer cannot be interrupted.
- New batches reopen the popup; ordinary progress never does. A renderer reload retains the backend queue and recovers its UI.
- Commands `uploads.show`, `uploads.hide`, and `uploads.stop({id})` share handlers with UI controls. Local copies use the same queue.

Scope: regular files, up to 100 pending items per window, sequential transfers. No automatic retry/resume after disconnection
or app exit; failures are explicit. Stopping may wait for an outstanding SSH request or its timeout. No destination overwrite,
directory upload, or persistent remote service is introduced.

Validation: `npm run build`; `tests/uploads.test.cjs`; `tests/upload-progress.cjs` locally and over configured SSH; existing
file-operation and remote-drop regressions. UI acceptance exercises native multi-file drops, immediate rows, progress,
hide/show, queued/API and active/button cancellation, cleanup, remaining-file completion, reload recovery, and collision errors.
