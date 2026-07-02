---
'@gemstack/ai-autopilot': minor
---

Bootstrap: `serveCheck` — a production-grade check that actually boots and serves the app.

Until now the full-fledged loop gated on a prompt verdict (`loopChecklist` asks the model whether the app is production-grade). `serveCheck(session, { serve, install?, build?, port?, healthPath? })` gives it teeth: inside the build's runner session it installs, optionally builds, `start`s the dev server, `preview`s until the port is reachable, and fetches a health path — turning any failure (install error, server exits on boot, a 5xx, unreachable) into a concrete `{ blockers }` verdict the improve loop then addresses. It satisfies the `checklist` step contract, and `mergeChecklists(...)` unions several checks so a pass must BOTH read production-grade AND actually run: `mergeChecklists(loopChecklist({ loop }), serveCheck(session, { serve: 'npm run dev' }))`. A runner that can't `start`/`preview` skips the check (passing, with a note) instead of blocking. Built on the #137 runner seam.
