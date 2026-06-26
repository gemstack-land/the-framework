---
"@gemstack/ai-sdk": minor
---

Remove the `@gemstack/ai-sdk/doctor` subpath (epic: framework-agnostic engine).

The AI doctor check registered into `@rudderjs/console`'s doctor registry, coupling the agnostic engine to the Rudder CLI. It has moved to the Rudder binding `@rudderjs/ai/doctor` (same import path on that package). The `./doctor` export is removed here.

**Breaking (0.x):** importing `@gemstack/ai-sdk/doctor` no longer resolves; use `@rudderjs/ai/doctor`. (The `@rudderjs/console` peer stays for now — `make:agent` and the `/server` provider still use it until they relocate too.)
