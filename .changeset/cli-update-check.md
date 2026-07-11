---
'@gemstack/framework': minor
---

Bare `framework` now tells you whether the CLI is up to date (#312): after the version footer it checks npm's `dist-tags.latest` (2.5s cap) and prints "Up to date" or "Update available: vX (you have vY). Run: npm i -g @gemstack/framework". Offline or on any fetch failure it prints nothing. Display only; no auto-update.
