---
"@gemstack/ai-autopilot": patch
---

FakeFs now enforces the same workspace-escape guard as the real runners. Its filesystem previously stored any path as a map key, so a `write('../evil.txt', ...)` that a real runner rejects was silently accepted. Code exercised only against `FakeRunner` never saw the escape path, then threw against Docker/Local/WebContainer. `FakeFs` now routes every path through the shared `safeSegments` guard, rejecting escapes and resolving `.`/`..` exactly as the real runners do.
