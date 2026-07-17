---
'@gemstack/framework': patch
---

Rework the run's agent + model picker into a tree (#656, #658). The dropdown's top level is the coding agents, each showing its logo (Claude / Codex, #656); hovering an agent reveals only that agent's own models, and picking a model sets both the agent and model together — so an incompatible pair (e.g. Codex with a Claude model) can no longer be chosen. The trigger shows the current agent's logo then the model, with the agent name in the tooltip.
