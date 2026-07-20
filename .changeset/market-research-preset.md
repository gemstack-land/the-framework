---
'@gemstack/framework': patch
---

New [Market research] preset (#694)

Researches the market, writes it to `MARKET_RESEARCH.md`, and queues a follow-up that
turns the findings into tickets. Researching and deciding what to build from the research
are separate runs, so a human can read the findings before anything is proposed.

`MARKET_RESEARCH.md` joins the context every run starts with, as a document the agent
reads rather than one it folds knowledge back into at merge.
