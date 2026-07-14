---
"@gemstack/framework": patch
---

Adding a project that isn't a git repo now initializes one for you instead of failing with `fatal: not a git repository`. `installProject` detects a non-repo folder and runs `git init` before its usual commit-and-install flow, so a plain directory can be added straight from the dashboard. The install result reports `initialized: true` when it did so.
