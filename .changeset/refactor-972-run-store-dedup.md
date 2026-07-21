---
'@gemstack/ai-sdk': patch
---

`CachedSubAgentRunStore.load()` now returns `null` (not `undefined`) when a `CacheAdapter` resolves `undefined` on a miss, matching `CachedAgentRunStore.load()`. The `CacheAdapter` contract already declares `Promise<T | null>`, so adapters that honour it are unaffected; adapters that resolve `undefined` now get the documented `null`.

Internal: both run-store families now share one storage implementation. All public exports (`InMemoryAgentRunStore`, `CachedAgentRunStore`, `newAgentRunId`, `InMemorySubAgentRunStore`, `CachedSubAgentRunStore` and their types) keep the same shape.
