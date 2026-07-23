---
"@gemstack/framework": minor
"@gemstack/framework-dashboard": minor
---

A run relayed to a connected device (#1067) now appears in the local project's session list and re-opens after a dashboard reload, instead of showing "This session is gone". The local daemon keeps a lightweight in-memory RunMeta for each relayed run (target 'remote', the device label, a status that flips when the relay stream ends) and merges it into the run list; the event backlog already survives via the daemon-side stream (#1077).
