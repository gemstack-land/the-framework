---
'@gemstack/ai-autopilot': minor
---

Point the flagship data persona at Prisma (installable) instead of the unpublished universal-orm

The bootstrap data persona told the agent to build the data layer on `universal-orm`, which isn't installable (`@universal-orm/core` 404s on npm), so from-scratch live builds stalled sanity-checking the stack and produced nothing. It now defaults to Prisma with concrete install/init steps (schema-first, migrations derived from the schema, a fully typed client), and the architect default no longer names an unpublished package. The persona export is renamed `universalOrmModeler` -> `dataModeler` (persona name `data-modeler`). Closes #181.
