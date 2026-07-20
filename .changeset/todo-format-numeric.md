---
'@gemstack/framework': patch
---

Use the numeric priority scale in the TODO_AGENTS.md format spec (#880)

The shipped spec described named tiers (URGENT / High / Medium / Low). The format was revised to
a numeric 0-10 scale — 10 is act-immediately, 0 is only-if-capacity — so the spec now matches.

Still no parser change: entries are read in file order and headings are skipped, so a
priority-sorted file drains in priority order.
