---
"@gemstack/framework": minor
---

Add `#` to the dashboard prompt editor to reference a project file as run context (#504). The finer-grained sibling of `@` (which focuses a whole repo): type `#` to filter the project's files (via `git ls-files`, honoring .gitignore) and pick one, inserting a chip that adds its repo-relative path to the run Context. Backed by a new `onProjectFiles` read RPC; localhost-only, since the relay has no checkout.
