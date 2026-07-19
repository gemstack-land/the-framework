---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Add the [Suggest tickets to work on] preset (#698)

Reads the repo's tickets, proposes the ones worth doing next as a multi-select with the
high-confidence ones pre-ticked, waits for you, and adds only what you approve to
`TODO_AGENTS.md`.

The attended way to fill the agent queue. `/` menu items can now carry hover text, so the
preset can say where its output lands.
