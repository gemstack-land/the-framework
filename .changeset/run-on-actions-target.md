---
"@gemstack/framework": minor
---

Run target: wire GitHub Actions into the "Run on" gear (#1050). The options gear gains a single-select "Run on" submenu (Current device, the default; GitHub Actions; Claude web as a disabled placeholder), and picking GitHub Actions runs the turn on a fresh Actions runner via the already-merged ActionsDriver instead of on this device. The choice sticks per project like the agent and model. A new `--run-on <local|actions>` flag drives it from the CLI; `actions` reads the repo owner/repo from the origin remote and a user token from `GH_TOKEN` (repo + workflow scopes). `local` is unchanged.
