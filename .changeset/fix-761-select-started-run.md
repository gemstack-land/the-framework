---
"@gemstack/framework": patch
---

Fix starting a second run navigating to the previous one (#761). The dashboard adopted the run it had just started by looking for "the run that is running", which was safe while a project could only have one. Since concurrent runs (#736) it is not: the previous run is still running, and the new one has not written its `run.json` yet, so the old run was the only match and the view parked on it.

`sendStart` now returns the run id the daemon allocated, which it already knows because it names the run's worktree with it, and the dashboard selects that run instead of inferring one. A run with no worktree (the non-git fallback) reports no id and keeps the previous behaviour, which is still correct there because one run at a time still holds.
