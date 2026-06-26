---
"@gemstack/ai-sdk": minor
---

Decouple the cache-backed run stores from `@rudderjs/cache` (epic: framework-agnostic engine).

`CachedAgentRunStore` and `CachedSubAgentRunStore` no longer lazy-import `@rudderjs/cache` or read a global `CacheRegistry`. They now take a required, caller-supplied cache via `{ cache }`, typed against the new exported `CacheAdapter` contract (a 3-method interface: `get` / `set` / `forget`). Bring any cache (redis, Memcached, a `Map`, a framework's cache).

**Breaking (0.x):**
- `new CachedAgentRunStore()` / `new CachedSubAgentRunStore()` with no cache now throw; pass `{ cache }`. (All in-repo and documented usage already passes it.)
- Default key prefixes changed from `rudderjs:ai:*` to `gemstack:ai:*`. These guard 5-minute-TTL ephemeral run snapshots, so the only effect on upgrade is that in-flight parked runs fall back to "not found" once (they self-heal). Override `keyPrefix` to keep the old value if needed.

Also made the Google prompt-cache registry fully neutral (it already accepted a BYO store): it now uses the shared `CacheAdapter` type and a `gemstack:ai:google-cache:` key prefix, with no `@rudderjs/cache` references.
