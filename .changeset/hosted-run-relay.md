---
'@gemstack/framework': minor
---

feat(framework): hosted run relay — watch one run from multiple browsers (#230)

The first slice toward shared team sessions: a run can now be watched live from more than one machine. `framework relay` hosts a relay; a run started with `framework "..." --share <relay-url>` publishes its event stream to it and prints a shareable URL. Anyone who opens that URL gets the same dashboard over SSE, replaying the run's full history and then following live — so two teammates watch one build together.

Reuses the existing dashboard: the SSE serving is factored into a shared helper and the page's stream/stop paths are now relative so they resolve both on the localhost dashboard and under the relay's `/r/<id>/`. New exports: `startRelay`, `relayPublisher`. Deliberately unauthenticated — accounts, teams, RBAC, and authorized steering layer on later; the relay only projects the stream, it never runs an agent.
