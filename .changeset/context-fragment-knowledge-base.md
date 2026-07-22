---
'@gemstack/framework': minor
---

feat(framework): context fragment points the knowledge base at a `knowledge-base/` folder (#683)

Splits the flat `KNOWLEDGE-BASE.md` into `knowledge-base/FACTS.md` and `knowledge-base/INSIGHTS.md`, and moves `DECISIONS.md` and `MARKET_RESEARCH.md` under `knowledge-base/`, with a `knowledge-base/**.md` catch-all. The on-before-mergeable prompt and the Market research preset name the same paths.
