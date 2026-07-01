---
"@gemstack/ai-autopilot": minor
---

Add the personas layer: stack-aware roles that make autopilot opinionated about the GemStack stack (Vike + universal-orm) instead of generic. `definePersona()` builds a role from a system prompt + skills (composed over `@gemstack/ai-skills`) + tools; `personaAgent()`/`personaWorkers()` materialize personas into Supervisor workers; `personaRoster()` describes them to a planner so plans route to the right role. Ships three built-ins: `vikePageBuilder`, `universalOrmModeler`, and `uiIntentDesigner` (the "declare intent, decouple implementation" UI guardrail). First child (#98) of the ai-autopilot end-to-end epic (#97).
