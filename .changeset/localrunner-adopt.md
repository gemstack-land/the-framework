---
"@gemstack/ai-autopilot": minor
---

feat(runner): `LocalRunner.adopt(dir)` binds an existing directory as the workspace

Adopt a directory that already exists instead of booting a fresh temp one. The
session reads, execs, starts, and previews inside it exactly like a booted
session, but `dispose` does not delete it (the directory belongs to the caller).
Fills a real gap in the runner seam: running or verifying code that another tool
already wrote to disk.
