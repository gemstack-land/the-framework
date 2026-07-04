---
'@gemstack/framework': minor
---

Extend an existing project instead of rebuilding it from scratch

Pointed at a workspace that already has source, the build step now frames the wrapped agent to work *within* the existing codebase (read it, follow its conventions, add what was asked) rather than scaffold a fresh app. Greenfield runs (an empty workspace) are unchanged, and detection is gated on a real driver, so `--fake` stays deterministic. Combined with the live preset detection already wired from the real workspace, running in an existing project now detects its real stack and extends it.

New exports: `extendPrompt`, `isWorkspaceEmpty`.

Part of #110. Closes #185.
