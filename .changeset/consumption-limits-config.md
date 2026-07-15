---
'@gemstack/framework': minor
---

Let the user set the consumption limits. The preferences now carry a checkbox and a percentage per limit, and `resolveConsumptionLimits` fills any gap with the defaults. Preference sanitizing was boolean-only, so a percentage was silently dropped on both read and write; it now validates per-limit and falls back to the default rather than leaving the account unguarded.
