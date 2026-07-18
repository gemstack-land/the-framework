---
'@gemstack/framework': minor
---

Expand the run-start context fragment (#683): alongside `DECISIONS.md` and `KNOWLEDGE-BASE.md` the agent now also sees `GOAL.md`, `tickets/**.md` (pointed at the `.the-framework/ticketing-format.md` spec from #684), and the `TODO-AGENTS.md` task queue. The set is split into `CONTEXT_DOCS` (read at start) and the `BUSINESS_KNOWLEDGE_DOCS` subset the agent also updates at merge, so the roadmap/queue pointers are read-only context.
