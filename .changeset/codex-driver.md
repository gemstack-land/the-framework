---
'@gemstack/framework': minor
---

Add `CodexDriver`: The Framework can drive the Codex CLI as a second agent, on the user's own ChatGPT subscription with no API key. Generalizes the agent-CLI process handling into `runAgentCli` so a second agent reuses it rather than copying it. Codex reports no price and no quota, so it omits usage rather than claim a run was free, and the consumption limits stay Claude-only.
