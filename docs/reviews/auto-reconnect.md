# Review: automatic SSH reconnection

When SSH drops, Owlet retries automatically without reloading the workspace. The status bar shows the retry state;
Explorer waits for a live connection, then refreshes. Clean files pick up remote changes and dirty buffers retain their
edits and conflict checks. Failed save operations are rejected, never replayed.

One connection and retry loop serve all windows on the same host. Attempts back off at 1, 2, 4, 8, 16, then 30 seconds.
**Connection: Reconnect SSH** retries immediately; **Connection: Disconnect SSH / Stop Reconnecting** cancels the loop.
Closing the last window for a host also stops its connection. Authentication and host-key failures need user attention.

Direct SSH shells end with the lost connection. Their scrollback remains visible and **Start new shell** stays explicit;
Owlet does not rerun terminal commands. Use a remote multiplexer for persistent agent sessions.

## Validation

- `npm run build` and `node --test tests/reconnect.test.cjs`.
- Packaged `tests/auto-reconnect.cjs`, with a configured `OWLET_SSH_TARGET`: real SSH transport loss, a simulated failed
  retry, automatic recovery, clean-file refresh, preserved dirty edits and conflicts, Explorer refresh, explicit terminal
  restart, manual cancellation/reconnect, and last-window cleanup while a local window stays open.
- Existing remote startup and local Vim/file acceptance tests.

SSH keepalives detect silent network outages, so the disconnected state can take roughly 30 seconds to appear.
Retries continue at the capped interval until recovery or cancellation; they do not bypass SSH authentication or host-key checks.
