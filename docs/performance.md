# Measured launch times

Measured on 1 November 2026 using the packaged Windows x64 app and a real Linux host over SSH.
These are individual regression runs, not statistical averages or guarantees for other machines.

| Connection | First directory ready | Additional project window | Additional window with 32 KiB text |
| --- | ---: | ---: | ---: |
| Existing VPN | 2.22 s | 2.13 s | 3.53 s |
| Same VPN, limited to 256 kbit/s each way, with 250 ms added RTT | 4.55 s | 2.06 s | 4.13 s |

All six measurements met the under-10-second target. The additional windows were opened through the integrated terminal
while an image transfer was in progress. Timing includes automated input and control overhead. The first-window measurement
starts at process launch and ends when the directory list is usable; it is not a reboot or cold filesystem-cache benchmark.

The remote helper was 8,102 compressed bytes. First-window application control traffic, including helper bootstrap,
was about 9 KiB; an additional project window used about 2 KiB. These figures exclude SSH encryption and handshake overhead,
file/image payloads, and unrelated terminal traffic. They are not total bytes on the VPN link.

Two packaged local-workspace checks reached their directories in **3.85 s** and **4.81 s**, with an intentionally unreachable default
SSH target overridden by `--local`. Local Markdown math, diagrams, and images also passed with browser networking disabled.
Local filesystem access and PowerShell do not use SSH; network shares naturally still require their network.

Owlet bundles Electron. The SSH runs recorded approximately **392–403 MiB** of summed process working sets after initial
listing; shared pages can be counted more than once. Focused features and low remote transfer do not imply a tiny runtime.

## Reproduce

Build and package the app, configure a noninteractive SSH test host, then run:

```powershell
$env:OWLET_SSH_TARGET = 'my-test-server'
$env:LWR_PACKAGED = (Resolve-Path release/Owlet/Owlet.exe).Path
node tests/fixture.cjs
node tests/performance.cjs
```

The test defaults to five runs of each profile. Set `LWR_PERF_RUNS=1` for the single-run regression used above.
`tests/throttle-proxy.cjs` applies bandwidth and latency limits to the real SSH transport. Results are written to
`artifacts/performance.json`. Host load, authentication setup, filesystem size, connection quality, and shell profiles
can change the timings; terminal readiness is separate from directory readiness.
