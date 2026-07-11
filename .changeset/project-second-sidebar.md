---
"@gemstack/framework": minor
---

Add the per-project second sidebar and main view. The second sidebar now shows the selected project's loops/prompts (its `.the-framework/LOGS.md`, scoped via `?project=<id>`) with its Runs archive below it, both following the selection. The main view shows the selected or latest loop/prompt claude.ai/code-style (kind, title, status, session link, and a loop's constituent prompts); clicking a loop in the sidebar opens it. On load the most recently active project is auto-selected, so the view is populated immediately.
