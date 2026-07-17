# Epic: Bring your own subscription (BYOS) — run the user's own coding-agent CLI

Bring your own subscription (BYOS): run the AI on the CLI the user already pays for, instead of reselling tokens or asking for API keys.

Idea from Traycer (open source). They don't touch keys. They run the user's already-installed coding-agent CLI (claude-code, codex, gemini), which already holds that subscription's auth. Requests go straight through it.

Fits our existing seams with almost no new concepts. Two plug points already exist:
- Runner (where code executes) — the local runner spawns the CLI.
- ai-sdk ProviderAdapter (which model does the work) — a new `cli/*` adapter.

BYOS = a new adapter that spawns the user's CLI through the local runner, plus a small discovery step. Other providers are just more entries: ChatGPT via Codex CLI, Gemini via Gemini CLI, Claude via Claude Code. A plain web subscription with no CLI is not reachable this way.

Plan:
- [ ] Spike `cli/claude-code` adapter + PATH discovery (child)
- [ ] Widen discovery to codex + gemini CLI
- [ ] Provider config: where the pick + custom paths persist (framework config, TBD with Rom)

Open calls for Rom:
- go/no-go on the spike
- config location: framework config (env-paths/XDG) vs a separate dotfile

---
Source: https://github.com/gemstack-land/gemstack/issues/495
