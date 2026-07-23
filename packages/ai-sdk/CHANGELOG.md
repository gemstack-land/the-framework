# @gemstack/ai-sdk

## 0.6.1

### Patch Changes

- cd121f4: fix(ai-sdk): a store whose unscoped `list()` hides other users' threads no longer fails open on resume-by-id

  The #984 owner check settles ownership from `ConversationStoreListEntry.userId`, falling back to an unscoped `store.list()` when the caller's scoped listing does not hold the thread. A thread missing from that unscoped listing was read as "no owner recorded" and allowed, which is right for a pre-#984 ownerless row but wrong for a store whose `list()` with no user id returns nothing. Such a store implements `list(userId)` correctly and is fully owner-aware, and a cross-user resume was still allowed.

  The unscoped listing reporting nothing at all, while the store demonstrably holds rows (the caller has threads of their own, or the target thread has messages), now proves the listing is not enumerating the backend, and the resume is refused with `ConversationOwnershipError`.

  Deliberately unchanged: a listing that reports rows but not this one stays permissive, since an absent thread and a partial listing are indistinguishable there. Ownerless legacy threads on a store that enumerates normally stay resumable, with or without a user on the run, and a store that omits `userId` from its entries keeps its old permissive behavior.

  `ConversationStore` gains no members. The listing contract the check depends on is now documented on the interface itself, where an implementer sees it, rather than only on the entry type's `userId` field.

- 780ef3e: Internal: the provider layer no longer carries four copies of the same code. Every adapter builds its SDK client through one shared `lazyClient()` helper, the five pure OpenAI-compatible providers (`xai`, `groq`, `deepseek`, `ollama`, `azure`) come from one factory, and the Anthropic stream-event mapping is shared with Bedrock instead of being inlined twice.

  Two side effects worth naming. A first client build is now memoised as a promise, so two concurrent calls share one client rather than racing to construct two, and a failed dynamic import no longer caches. And `XaiProvider.name` and friends are typed `string` rather than the literal `'xai'`, matching the `ProviderFactory` contract they are consumed through.

  All public exports keep their names, constructor signatures, and default base URLs.

- 23c1fb7: `CachedSubAgentRunStore.load()` now returns `null` (not `undefined`) when a `CacheAdapter` resolves `undefined` on a miss, matching `CachedAgentRunStore.load()`. The `CacheAdapter` contract already declares `Promise<T | null>`, so adapters that honour it are unaffected; adapters that resolve `undefined` now get the documented `null`.

  Internal: both run-store families now share one storage implementation. All public exports (`InMemoryAgentRunStore`, `CachedAgentRunStore`, `newAgentRunId`, `InMemorySubAgentRunStore`, `CachedSubAgentRunStore` and their types) keep the same shape.

## 0.6.0

### Minor Changes

- 46c79a6: fix(ai-sdk): a resumed conversation id is now checked against the user the run is scoped to

  `preparePersistence` loaded a conversation by id without ever reading `spec.user`, so `agent.forUser('alice').continue(bobsConversationId)` read Bob's whole thread into Alice's run and appended Alice's turn back into it. The same reached through `prompt(input, { conversation: { user: 'alice', id: bobsConvId } })` and through the streaming variant. Conversation ids are ordinary identifiers here, not secrets, and a resume endpoint takes one straight off a request.

  The owner was already recorded at create time and simply never consulted. It is now read back before the load, and a mismatch throws the new `ConversationOwnershipError` (exported, so a server can answer 403 rather than 500). The error names the conversation and the user the run was scoped to, never the real owner.

  `ConversationStore.load()` is unchanged. Ownership is read from `ConversationStoreListEntry.userId`, a new optional field mirroring `ConversationStoreMeta.userId` the way `agent` already does, and `MemoryConversationStore` reports it.

  Two deliberately permissive cases:

  - A thread whose stored meta carries no `userId`, and any store that does not report `userId` in its listings, stays resumable by whoever holds the id. Existing stored conversations do not become unreadable.
  - A bare `continue(id)` with no user is not a special error; it carries an empty user and fails the same owner check, so it still resumes unowned threads and is refused for owned ones.

  That second point changes a documented flow: `myAgent.forUser('u').prompt(...)` followed by `myAgent.continue(id).prompt(...)` now throws. Chain `forUser('u').continue(id)` instead. The docs shipped with the package have been corrected.

### Patch Changes

- f6efb7d: Tool calls alongside a handoff now dispatch in parallel like every other batch (#971)

  `tool-execution.ts` implemented the tool phase twice, once serial and once parallel, with
  every gate written in both copies: unknown-tool, client-tool stop and placeholder, approval
  rejected and pending, `onBeforeToolCall` skip/abort/transformArgs, and argument validation.
  The `executeMaybeStreaming` pause-detection loop was duplicated near byte-for-byte,
  differing only in `yield` versus a push into a buffer.

  The copies had already drifted. The handoff branch existed only in the serial path, so
  `executeToolPhase` force-downgraded the whole step to serial whenever any call in it was a
  handoff. The gate chain is now one function, `decideToolCall()`, that returns a decision
  both paths consume, and one shared generator drives execution for both. The parallel path
  gained the handoff branch from that, so the downgrade is gone.

  The only user-visible change: in a step that mixes ordinary tool calls with a handoff, the
  ordinary calls decided before the handoff now run concurrently instead of one after another.
  Everything downstream is unchanged. The first handoff in a step still wins, later calls are
  still skipped with the same synthetic result rather than executed, and the tool messages are
  still emitted in tool-call order with identical content. Apps that need the old ordering can
  already opt out with `parallelTools: false`.

- f38f80b: Fix `toVercelDataStream` so the wire matches the AI SDK v4 Data Stream Protocol it advertises. Tool results were never emitted at all, and the prefixes it did emit were mismapped: tool call streaming start went out on `9:` instead of `b:`, and argument deltas went out on `a:` instead of `c:`. Because `a:` is the Tool Result part, `useChat()` read every argument delta as a tool result with `result: undefined` and resolved the tool-call chip before the model had finished writing its arguments.

  Tool results now go out on `a:`, streaming start on `b:`, argument deltas on `c:`, and a complete `9:` tool call with its `args` is emitted. Argument deltas now carry the correlated `toolCallId` on adapters that ship args as a bare text delta, and the Finish Message part carries `usage` alongside the Finish Step part.

## 0.5.1

### Patch Changes

- 6f7cf23: Fix four correctness bugs around streaming, SSE and the embedding cache.

  - `Agent.stream()` invoked `conversational()` and `remembers()` twice for any agent that overrides them asynchronously: once in the synchronous fast-path probe (where the returned promise was dropped on the floor) and again on the async path. An override doing a DI or DB lookup ran its side effects twice per call, and a rejection from the first, unhandled promise could abort the process. Both are now called once and the values threaded through.
  - `readAgentStream`'s "skip malformed JSON" guard also swallowed every error thrown by the consumer's own SSE callbacks, losing the diagnostic and leaving the turn half-mutated. It now parses inside the guard and applies outside it.
  - `parseSseStream` released the reader lock without cancelling the body, so any early exit (a `stopWhen`, an approval pause, a consumer `break`) left the upstream HTTP connection open until the server timed it out.
  - `CachedEmbeddingAdapter` reported zero token usage even when it _did_ call the provider, so anything aggregating usage undercounted embedding spend entirely; it now reports what the provider charged for cache misses. Its cache is also no longer unbounded (new `maxEntries` option, default 10_000, oldest evicted first).

  `CachedEmbeddingAdapter` had no test coverage; it now has a suite.

- 6f7cf23: Tidy the public surface, drop the last brand leaks, and correct docs that contradicted the code.

  - `web_search`'s fallback now extracts text with `htmlToText` instead of the `<[^>]*>` regex that the same file's docblock documents as forbidden (polynomial ReDoS, trips CodeQL). It also stops leaking `<script>` / `<style>` _content_ into the model's context.
  - Export types that were unnameable despite being public: `ServerToolBuilder` (the return type of `Agent.asTool()`, `scopedTool()`, `similaritySearch()` and `toolDefinition().server()`), plus `ProviderHint`, `ConversationalSpec`, `ConversationalOverride`, `ConversationStoreListEntry`, `FileSearchFallback`, `SimilaritySearchWhereOperator`, `SchemaIo` and `CachedEmbeddingOptions`.
  - Replace the remaining `Rudder` references in user-visible strings: a synthesized tool-result message the _model_ reads, the `User-Agent` sent by `web_search` / `web_fetch`, and error/doc copy that told `@gemstack/ai-sdk` users to rely on a framework they may not be running.
  - Delete "Phase N will add …" doc comments for features that already ship in the same file (`computerUseTool`, the file-search `fallback` option), and stop a fixture-version error from telling users to re-record with a CLI command that lives in another package.

- da79ec8: Fix four provider protocol defects found in the AI package sweep.

  - Google prompt caching dropped the system instruction and every tool declaration from the request even when the cache markers had not cached them, so a marker set like `{ messages: 2 }` silently sent neither.
  - Google streaming derived its finish reason from Gemini's raw value. Gemini reports `STOP` for a function-call turn, so a streamed tool call ended the run instead of returning the tool results to the model, while a `SAFETY` or `MAX_TOKENS` stop claimed tool calls existed and kept the loop running.
  - Anthropic joined `ContentPart[]` system content with `Array.prototype.join`, sending `[object Object]` as the system prompt.
  - OpenAI never set `stream_options: { include_usage: true }` and discarded the trailing usage chunk, so every streamed call reported no token usage to budget accounting. Truncation and content-filter stops now map to `length` and `content_filter` instead of a clean `stop`.

## 0.5.0

### Minor Changes

- dbc8b3a: Make `agent.queue()` / `.broadcast()` framework-agnostic. The engine no longer dynamically imports `@rudderjs/queue` or `@rudderjs/broadcast`; instead register a neutral adapter once at startup with the new `configureAiQueue({ dispatch, broadcast })`. New public exports: `configureAiQueue`, and the `QueueDispatch` / `QueueBroadcast` types. Rudder users get this wired automatically by `@rudderjs/ai`'s provider (no app change). This removes the last `@rudderjs/*` reference from the engine source.
- 1b2ba93: Remove the relocated Rudder bindings from the engine: the `/server` provider, the `make:agent` scaffolder, and the `ai:eval` CLI command, plus the `@rudderjs/core` and `@rudderjs/console` optional peers. These now live in `@rudderjs/ai` (Rudder users pick them up there unchanged). The framework-agnostic engine no longer carries any `@rudderjs/*` peer dependency for these paths. Closes the ai-sdk/Rudder decouple epic.

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
