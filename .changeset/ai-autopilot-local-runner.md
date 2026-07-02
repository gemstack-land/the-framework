---
"@gemstack/ai-autopilot": minor
---

Add `LocalRunner`, the first real adapter behind the runner seam. Where `FakeRunner` simulates a workspace in memory, `LocalRunner` boots each workspace as a real temp directory on the host: real files via `node:fs` (path-traversal guarded to the workspace root), real commands via `child_process` (shell, per-command `cwd`/`env`/`timeoutMs`), a localhost `preview`, and a `dispose()` that removes the workspace. It is the reference the sandboxed adapters (WebContainer, Docker, Flue) mirror. It runs commands unsandboxed on the host, so it is documented for trusted/CI use only, not untrusted agent-authored code. Part of the ai-autopilot epic (#97), issue #106.
