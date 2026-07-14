---
"@gemstack/ai-autopilot": patch
---

Remove the Vike nudge from the architect system prompt. The prompt no longer tells the model to "Prefer Vike as the default" or to "Default to the GemStack stack (Vike + Prisma)"; it now picks the stack that best fits the app and reasons from the objective Vike-vs-Next tradeoffs without favoring either. Nudging toward a framework in a system prompt erodes trust in the architect's rationale.
