---
'@gemstack/framework': patch
---

Label the dashboard session link honestly

Our runs are headless, which is deliberately not Remote-Controlled, so the default `https://claude.ai/code` link is a generic entry point, not a live per-run session. The dashboard now labels it **Open Claude Code** instead of "live session"; the "live session" label is kept only for a real user-supplied `--session-link`. The real session id (the local transcript id, usable with `claude --resume`) is still shown.

The README's session section is rewritten to be accurate: to steer a session live in the browser you start your own interactive `claude auth login` + `claude --remote-control --name <run>` session and open it from claude.ai/code, which is a separate process from an orchestration run. Corrects the overpromise from #212. Closes #221.
