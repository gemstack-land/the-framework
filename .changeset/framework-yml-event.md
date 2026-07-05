---
'@gemstack/framework': minor
---

the-framework.yml gains an `event:` key so a repo can pin its build event kind (e.g. `bug-fix`) alongside `preset`/`autopilot`/`technical`. Precedence: `--kind` flag > `the-framework.yml` event > preset default > `major-change`.
