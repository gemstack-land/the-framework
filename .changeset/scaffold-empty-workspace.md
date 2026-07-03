---
'@gemstack/framework': minor
---

Recover from-scratch builds: scaffold an empty workspace instead of only polishing

The full-fledged loop assumed an app already existed, so a from-scratch run could end at the framework's default "Welcome" page. The build step now verifies it produced files and hard re-prompts to scaffold from scratch if the workspace is still empty; the improve step switches to a "create the whole app from scratch" directive when the workspace is empty (instead of "smallest change / no unrelated features"); and the default `--max-passes` is raised from 3 to 5 so a from-scratch build has room to recover. Also clarifies the dashboard/terminal end status ("finished", not "done", so it reads as separate from the production-grade badge). Closes #182.
