---
'@gemstack/framework': patch
---

Don't offer the current project as a Context focus target (#665). The Context → Projects list is for pulling *other* repos into the agent's focus; the current project is already the run's workspace, so ticking it was redundant. It's now excluded from the list (and from the "N projects" count), with a "No other repos to add" hint when it's the only registered project.
