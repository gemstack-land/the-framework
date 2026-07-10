---
'@gemstack/framework': patch
---

fix(framework): surface session-scoped PLAN/TODO docs in the dashboard sidebar (#323)

The document sidebar now also surfaces the session-scoped `PLAN_<SESSION>.agent.md` / `TODO_<SESSION>.agent.md` files The Framework writes per run (#323/#326), not just flat `PLAN.md` / `TODO.md`. Flat files stay supported as a fallback for hand-written docs. Names are matched against the workspace root with a fixed slug pattern, so there is still no path traversal.
