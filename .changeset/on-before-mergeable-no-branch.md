---
"@gemstack/framework": patch
---

The on-before-mergeable follow-up no longer strands its output on a branch nothing merges. It was spawned as a plain `framework prompt` run, so it inherited the #326 system prompt's `### Session name` step and committed + created + checked out a fresh `the-framework/<name>` branch before writing anything. Its output (the queued quality TODO entries and the business-knowledge docs, `DECISIONS.md` / `KNOWLEDGE-BASE.md`) landed on that branch, which nothing merges, so the next run branched from main and could not see it. The follow-up is a follow-up to a session, not a session of its own, so it now runs `--vanilla` (no built-in prompt, hence no session-name step) and stays on the session's current branch, where its output rides to review and merge with the work.
