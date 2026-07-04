---
'@gemstack/framework': patch
---

Fix the Claude Code driver treating a non-zero agent exit as success when the agent had already streamed some text. A crash mid-build now fails the turn (surfacing stderr or the partial text) instead of resolving as a result the loop can score production-grade.
