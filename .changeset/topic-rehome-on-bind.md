---
"@gemstack/the-framework": minor
---

feat(the-framework): re-home a bound topic run into its project (#1122): the daemon watches for the recorded bind, allocates a worktree in the chosen project, resumes the same agent session there via continue-run, and tears down the scratch, so a bound topic run becomes an ordinary run living in the project's worktree
