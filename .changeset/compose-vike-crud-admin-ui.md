---
'@gemstack/ai-autopilot': minor
---

Compose vike-crud / vike-admin for the CRUD/admin UI instead of hand-writing screens

The composed stack taught the agent to compose vike-auth (identity) and the universal-orm data layer (domain data), but it still hand-wrote the list/record/form screens and admin panel, which is the largest chunk of fresh, churn-prone AI code. The new `vike-crud-composer` persona (wired into `vikeExtensionPersonas`) teaches the agent to derive those screens from the schema instead: `crud({ table })` / `crudBlocks({ table })` inside a `definePage`, rendered through `vike-crud/react` (or `/vue`); vike-admin dropped on top for a whole-DB `/admin/*` panel via the cumulative `adminResources` seam; mutations through named `crudActions` (`posts.delete`) rather than inline closures; and the config -> slot -> eject customization ladder so eject is the last resort, not the starting point. Everything rides the one universal-orm adapter already registered, so there is nothing extra to install. No runtime change; the agent stays a black box. Part of #186. Closes #189.
