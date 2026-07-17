---
'@gemstack/framework': minor
---

Keep the flat backlog under a root `tickets/` directory (`tickets/TODO.md`) instead of the repo root, so The Framework rides on a plain, visible convention (beside `DECISIONS.md`) rather than a proprietary file (#629). New backlogs are created there, the dashboard surfaces it, and a legacy root `TODO.md` is still read so existing repos keep their backlog. Session-scoped `TODO_<slug>.agent.md` files are unchanged.
