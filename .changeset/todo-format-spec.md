---
'@gemstack/framework': minor
---

Ship a TODO_AGENTS.md format spec the agent can read (#880)

The backlog had no written layout, so each agent invented one. The package now ships
`prompts/todo_format.md`, and the context fragment points at it the same way it already
points at the ticket format: by its `node_modules` path, so the layout versions with the
package instead of going stale in a committed file.

The format is a priority-sorted file with `## URGENT`, `## High priority`,
`## Medium priority` and `## Low priority` sections. It needs no parser change, because
entries are read in file order and headings are skipped, so a priority-sorted file drains
in priority order.
