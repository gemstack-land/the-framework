---
"@gemstack/ai-sdk": minor
---

Export `GoogleCacheRegistry` (+ `GoogleCacheRegistryOptions` / `CacheStoreLike`) from the main entry, and `defaultFixturesDir` / `readFixture` / `writeFixture` from the `./eval` subpath.

These were gemstack-internal symbols that framework bindings could not reach against a published build. Surfacing them lets a binding construct the Gemini context-cache registry with its own `CacheAdapter` (`new GoogleCacheRegistry({ store })`) and lets an `ai:eval` CLI binding read/write recorded fixtures. Purely additive; unblocks relocating the `/server` provider and the `ai-eval` command to the Rudder side.
