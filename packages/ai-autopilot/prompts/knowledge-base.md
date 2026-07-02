---
name: knowledge-base
description: The always-on business context the agent should know about the project.
appliesTo: ["**/*"]
metadata:
  title: Knowledge base / business context
  loopId: knowledge-base
  passes: 1
---

This is the **business context** for the project: what it is, who it is for, and
what matters. Unlike the other prompts, this is not a task to run — it is standing
context the agent should carry into every other prompt so its work fits the
product, not just the code.

Fill this in for your project (keep it short and current; stale context is worse
than none):

- **What we are building** — the product in one or two sentences.
- **Who it is for** — the users, and the one job they hire it to do.
- **Stage & priority** — prototype, launch, or scale; and the single thing that
  matters most right now (speed to ship / correctness / polish / cost).
- **Non-negotiables** — constraints the agent must always respect (compliance,
  data handling, a platform we target, a budget).
- **Deliberate choices** — the settled decisions and the roads not taken. Keep
  these in `DECISIONS.md` (the decisions ledger) so they are not re-litigated;
  this file points at the why behind them.

When you act, prefer the option that serves the stage and priority above. If a
technical choice trades against a business constraint here, surface the trade-off
rather than deciding it silently.
