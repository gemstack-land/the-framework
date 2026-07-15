---
'@gemstack/framework': minor
---

Add `--agent claude|codex`, which picks the agent that drives a run. The Codex driver shipped but nothing selected it, so it was unreachable; now both driver paths (the build itself and the auto-select routing turn before it) honor the flag, and preflight probes the agent you asked for rather than always `claude`. Default stays `claude`.

Codex reports no price and no quota, so the spend cap and the consumption limits cannot gate it and previously would have no-opped in silence. A run now says which guards are not in force instead of letting `--max-cost` imply one, and it no longer offers a Claude Code session link for a session that isn't Claude's.
