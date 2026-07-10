---
'@gemstack/framework': patch
---

fix(framework): re-fire the plan-approval gate after picking an alternative (#324)

Picking an alternative at the plan-approval gate re-architects the plan, and that fresh plan can differ a lot from the one you rejected. The gate now re-fires on the re-architected plan so you approve the plan you will actually build, not just the first one. Bounded to a few re-architect rounds so a run of alternative-picks can't loop forever.
