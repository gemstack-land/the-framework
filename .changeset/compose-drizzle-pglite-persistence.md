---
'@gemstack/ai-autopilot': minor
---

Teach the compose personas the opt-in real-persistence path (drizzle + pglite)

The composed stack (vike-auth + the universal-orm data layer) runs on the memory adapter, which resets on every server restart, so accounts and posts vanish on reboot. The `vike-data-modeler` persona now teaches the "make it real" swap: register the Drizzle adapter over an embedded pglite Postgres instead of the memory adapter, add the `vikeSchema()` Vite plugin to codegen `drizzle/schema.generated.ts`, and derive/apply migrations with drizzle-kit. Because auth and domain data ride the same one adapter, that single swap makes both durable at once; `defineSchema` tables and `db()` queries do not change. The `vike-auth-composer` persona points at the same step, and the memory adapter stays the zero-config dev default. Reference: the proven `examples/drizzle-pglite` twin. Part of #186. Closes #187.
