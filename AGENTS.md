# Working on Owlet

Owlet is an agent-native reader and editor for inspecting coding agents' work. It is not an IDE. Keep startup fast, remote traffic small, and the interface compact.

## Commands are a first-class product surface

- Every meaningful user action must have a named command in `window.owletCommands`, discoverable in the command palette. Do not introduce a button-only feature. Keep commands visible for now; unavailable actions may be disabled with accurate state.
- UI controls, keyboard shortcuts, and agent calls must use the same command handler and the same validation and save/conflict safeguards. Components may own rendering and transient interaction state, but must not implement a competing action path.
- Commands that target files, folders, groups, sizes, text, or URLs must accept structured arguments. Palette invocation without arguments should offer a usable prompt or a sensible current-context action. Keep IDs stable and document parameters.
- Use names and search aliases people recognize: for example, Remote, Open Remote, and SSH should find the connection action. Do not rely on users knowing implementation terms.
- Direct typing, cursor/selection movement, scrolling, hover, drag capture, and editing an unsubmitted form are widget interactions, not one command per input event. Their meaningful outcomes still need commands: edit buffer text, send terminal text, focus a group, move a tab, resize a pane, submit a connection, or save a color. Confirmation and cancellation belong to the originating command; never bypass them merely to make automation easier.
- Audit new UI actions against `docs/commands.md`. Add behavioral coverage for new command paths and meaningful UI/API equivalence; a test that only repeats the registry is insufficient.

## Architecture and validation

- Keep filesystem and terminal access behind Electron's validated preload API and the local/SSH backends. Markdown must not gain access to command execution or Node.
- Preserve explicit saves, dirty buffers, revision conflict checks, and independent local/SSH windows. Do not install a persistent remote daemon.
- Use the six spacing tokens in `src/styles.css`; component dimensions are distinct from spacing. Preserve terminal fit above the status bar.
- Run `npm run build` after TypeScript/UI changes. Run the focused acceptance test for the changed behavior, plus relevant existing regressions. SSH tests use a configured `OWLET_SSH_TARGET`; never hardcode a private host.
- Inspect rendered UI when changing layout or visible controls. Do not close or reload the user's active windows or direct shells to install a test build.
- Keep README benefits and Getting Started concise. Put command details and operational constraints in linked documentation. Preserve the MIT license and dependency notices in packages.
