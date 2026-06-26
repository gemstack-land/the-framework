# @gemstack/ai-sdk

## 0.4.0

### Minor Changes

- e784b5d: Decouple the cache-backed run stores from `@rudderjs/cache` (epic: framework-agnostic engine).

  `CachedAgentRunStore` and `CachedSubAgentRunStore` no longer lazy-import `@rudderjs/cache` or read a global `CacheRegistry`. They now take a required, caller-supplied cache via `{ cache }`, typed against the new exported `CacheAdapter` contract (a 3-method interface: `get` / `set` / `forget`). Bring any cache (redis, Memcached, a `Map`, a framework's cache).

  **Breaking (0.x):**

  - `new CachedAgentRunStore()` / `new CachedSubAgentRunStore()` with no cache now throw; pass `{ cache }`. (All in-repo and documented usage already passes it.)
  - Default key prefixes changed from `rudderjs:ai:*` to `gemstack:ai:*`. These guard 5-minute-TTL ephemeral run snapshots, so the only effect on upgrade is that in-flight parked runs fall back to "not found" once (they self-heal). Override `keyPrefix` to keep the old value if needed.

  Also made the Google prompt-cache registry fully neutral (it already accepted a BYO store): it now uses the shared `CacheAdapter` type and a `gemstack:ai:google-cache:` key prefix, with no `@rudderjs/cache` references.

- 97ed299: Remove the `@gemstack/ai-sdk/doctor` subpath (epic: framework-agnostic engine).

  The AI doctor check registered into `@rudderjs/console`'s doctor registry, coupling the agnostic engine to the Rudder CLI. It has moved to the Rudder binding `@rudderjs/ai/doctor` (same import path on that package). The `./doctor` export is removed here.

  **Breaking (0.x):** importing `@gemstack/ai-sdk/doctor` no longer resolves; use `@rudderjs/ai/doctor`. (The `@rudderjs/console` peer stays for now — `make:agent` and the `/server` provider still use it until they relocate too.)

- 4fa5820: Decouple from `@rudderjs/orm` (epic: framework-agnostic engine).

  The ORM-backed store subpaths `@gemstack/ai-sdk/conversation-orm`, `/memory-orm`, `/budget-orm`, and `/memory-embedding` are **removed** from this package. They imported `@rudderjs/orm`, coupling the agnostic engine to the Rudder ORM, so they have moved to the Rudder binding `@rudderjs/ai` under the same subpath names (`@rudderjs/ai/conversation-orm`, etc.). The `@rudderjs/orm` peer dependency is dropped.

  **Breaking (0.x):** update imports from `@gemstack/ai-sdk/{conversation-orm,memory-orm,budget-orm,memory-embedding}` to `@rudderjs/ai/{...}`. The relocated implementations are unchanged and still implement the neutral `ConversationStore` / `UserMemory` / `BudgetStorage` contracts, which remain exported from `@gemstack/ai-sdk`. Non-Rudder apps implement those contracts against their own persistence, or use the in-memory defaults.

- cf28664: Export `GoogleCacheRegistry` (+ `GoogleCacheRegistryOptions` / `CacheStoreLike`) from the main entry, and `defaultFixturesDir` / `readFixture` / `writeFixture` from the `./eval` subpath.

  These were gemstack-internal symbols that framework bindings could not reach against a published build. Surfacing them lets a binding construct the Gemini context-cache registry with its own `CacheAdapter` (`new GoogleCacheRegistry({ store })`) and lets an `ai:eval` CLI binding read/write recorded fixtures. Purely additive; unblocks relocating the `/server` provider and the `ai-eval` command to the Rudder side.

- 3cb13db: Decouple `ImageGenerator.store()` / `AudioGenerator.store()` from `@rudderjs/storage` (epic: framework-agnostic engine).

  Both `.store()` helpers no longer lazy-import `@rudderjs/storage`. They now take a required, caller-supplied storage via a new exported `StorageAdapter` contract (a one-method interface: `put(path, bytes)`). Implement it against any blob store (S3, GCS, the filesystem, a framework's storage layer).

  **Breaking (0.x):** `.store(path)` is now `.store(path, storage)`. Migrate `await ImageGenerator.of(p).store('out.png')` to `await ImageGenerator.of(p).store('out.png', storage)` where `storage` satisfies `StorageAdapter`. A Rudder app wraps `@rudderjs/storage` in a ~3-line adapter.

### Patch Changes

- 035050e: Quality pass for ai-sdk: rebrand the error/log message prefix from the migration leftover `[Rudder AI]` to `[ai-sdk]` (108 messages across 38 modules), matching the sibling packages' package-name prefix convention, and fix the "file an issue" URL in the Bedrock provider to point at `gemstack-land/gemstack`. No API or behavior change beyond the message text.

## 0.3.0

### Minor Changes

- 9da9b29: Remove the `./mcp` subpath. The agent<->MCP bridge (`mcpClientTools` / `mcpServerFromAgent`) has moved to its own package, `@gemstack/ai-mcp`, so the optional `@modelcontextprotocol/sdk` peer dependency is now declared only by the package that uses it (and no longer surfaces to every `@gemstack/ai-sdk` consumer).

  Migration: replace `@gemstack/ai-sdk/mcp` imports with `@gemstack/ai-mcp`, and move the `@modelcontextprotocol/sdk` peer to that package. The bridge API is unchanged.

## 0.2.0

### Minor Changes

- e867923: Decouple the core from Rudder: `@gemstack/ai-sdk`'s only required runtime dependency is now `zod`. Schema conversion uses Zod 4's native `z.toJSONSchema` directly instead of `@rudderjs/json-schema` (dependency removed). `@rudderjs/console` is demoted from a hard dependency to an optional peer (only the `/doctor` check and `/commands/make-agent` scaffolder use it). `@rudderjs/core` (`/server` provider) and `@rudderjs/orm` (the `*-orm` stores) remain optional peers behind their opt-in subpaths. A non-Rudder app can now install and use the SDK with zero `@rudderjs/*` packages. No public API change on the main entry.
