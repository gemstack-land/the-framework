---
"@gemstack/framework": patch
---

Give each GitHub Actions run (`--run-on actions`, #1050) a correlation id that is unique across driver processes. The id seeded a per-process counter, so a fresh `framework run` process restarted it at 1 and every run's first turn was `actions-1-turn-1`; a new run could then match an earlier, identically named run still in the recent-runs window and report its stale result. The session id now mixes in a random tag, so a run only ever finds its own workflow run.
