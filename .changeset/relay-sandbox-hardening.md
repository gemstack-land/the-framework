---
'@gemstack/framework': patch
---

fix(framework): harden the run relay and workspace sandbox against resource exhaustion

- The relay now caps how many runs it holds in memory and evicts the least-recently-used one on overflow. Because it is unauthenticated, an anonymous request to `/r/<id>/…` could previously create per-run state that was never freed; run creation is now bounded (`maxRuns`, default 200).
- A disconnected SSE viewer now cancels its stream iterator, releasing its waiter immediately instead of lingering on the stream until the next event (which may never arrive for an idle run).
- `snapshotWorkspace` checks a file's size before reading it, so a large asset in the workspace is skipped without ever being loaded into memory during a `--sandbox docker` sync.
- `relayPublisher`'s POST has a timeout, so a relay that accepts a connection but never responds can no longer hang the CLI on exit (`flush()`).
