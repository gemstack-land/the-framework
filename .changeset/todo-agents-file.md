---
'@gemstack/framework': minor
---

Move the flat backlog from `tickets/TODO.md` to a root `TODO-AGENTS.md` (#682), so `tickets/` holds only tickets. New backlogs are created at `TODO-AGENTS.md`; the loop, the resume-note appender, and the dashboard doc sidebar all read it, and existing `tickets/TODO.md` (and a pre-#629 root `TODO.md`) are still read as fallbacks so no repo loses its backlog. Exposes `LEGACY_TICKETS_TODO_FILE` alongside the existing `LEGACY_TODO_FILE`.
