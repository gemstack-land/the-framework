---
"@gemstack/framework": minor
---

feat: `framework` CLI exposes Claude Code's permission mode

Add `--permission-mode <default|acceptEdits|bypassPermissions|plan>` and
`--dangerously-skip-permissions`, threaded into `ClaudeCodeDriver`, so a live run
can build non-interactively. Default stays `acceptEdits`.
