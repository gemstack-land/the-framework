# Memory & Persistence

An agent run is stateless by default: each `prompt()` starts a fresh context. This page covers the three things that make agents feel like they remember across calls, plus prompt caching to keep that context cheap:

- **Prompt caching** - mark stable parts of the prompt cacheable so providers skip re-billing the unchanged prefix.
- **Conversation persistence** - keep the full message thread so a follow-up turn can pick up where the last one left off.
- **User memory** - persist *facts* about a user that travel across conversations, independent of any single thread.

The engine ships **neutral contracts plus in-memory defaults**. Both `ConversationStore` and `UserMemory` are interfaces with a Map-backed implementation good for tests and dev; for production you bring your own backend by implementing the interface against your own database, Redis, or external service. The ORM-backed implementations (Prisma / Drizzle / native) live in the Rudder binding `@rudderjs/ai`, not in this engine.

Every example assumes a provider is registered:

```ts
import { AiRegistry, AnthropicProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

See [/guide/installation](/guide/installation) for setup.

## Prompt caching

Mark stable parts of the prompt as cacheable. Provider adapters translate the markers to native cache primitives: Anthropic adds `cache_control: { type: 'ephemeral' }` to the last content block of each marked region, OpenAI uses `prompt_cache_key` for routing affinity, and Google translates to `cachedContent` resources via a pluggable registry. Cache hits typically save 50-90% on input tokens.

Declare cacheable regions with `cacheable()` on the agent class:

```ts
import { Agent } from '@gemstack/ai-sdk'

class SupportAgent extends Agent {
  instructions() { return LONG_SYSTEM_PROMPT }
  tools()        { return [/* ... */] }

  cacheable() {
    return { instructions: true, tools: true }
  }
}
```

`messages: N` caches the first N messages (oldest first) - useful for multi-turn conversations where early context is stable:

```ts
class ChatAgent extends Agent {
  cacheable() { return { messages: 4 } }   // cache up to message[3]
}
```

Per-call override:

```ts
await agent.prompt('one-off',   { cache: false })          // disable for this call
await agent.prompt('different', { cache: { tools: true } }) // replace the agent default
```

The full marker shape (`CacheableConfig`):

| Field | Type | Meaning |
|---|---|---|
| `instructions` | `boolean` | Cache the system instructions. |
| `tools` | `boolean` | Cache the tool definitions. |
| `messages` | `number` | Cache the first N (oldest) messages. |
| `ttl` | `string` | Cache lifetime as a duration string (`'30m'`, `'2h'`, `'1d'`). Default `'1h'`. |

Google's `cachedContent` resources are stateful and have a configurable TTL - set it via `ttl` (default `'1h'`, max ~24h depending on the model). Anthropic and OpenAI ignore `ttl` because their cache layers do not expose a per-call lifetime knob:

```ts
class SupportAgent extends Agent {
  cacheable() { return { instructions: true, tools: true, ttl: '6h' } }
}
```

The Google `cachedContent` registry (`GoogleCacheRegistry`) defaults to an in-process `Map` and warns once on first use. For multi-worker deployments, construct it with your own `CacheAdapter` (the neutral cache contract this engine exports) so cache resources survive across processes and restarts instead of being recreated per worker:

```ts
import { GoogleCacheRegistry, type CacheAdapter } from '@gemstack/ai-sdk'

const registry = new GoogleCacheRegistry({ store: myCacheAdapter /* implements CacheAdapter */ })
```

Adapters that do not support caching ignore the markers - the request still runs, uncached.

## Conversation persistence

Conversation persistence keeps the full message thread so a follow-up turn resumes the prior context. Register a `ConversationStore`, then call `.forUser(userId)` to start a new conversation or `.continue(conversationId)` to resume one:

```ts
import { Agent, setConversationStore, MemoryConversationStore } from '@gemstack/ai-sdk'

setConversationStore(new MemoryConversationStore())   // in-memory default: dev / tests

const first  = await new AssistantAgent().forUser('user-42').prompt('My name is Alice.')
const second = await new AssistantAgent().forUser('user-42').continue(first.conversationId!).prompt("What's my name?")
// second.text -> 'Your name is Alice.'
```

Keep `forUser()` on the resume call: a thread is owned by the user it was created for, and resuming it as a different user (or as no user at all) throws `ConversationOwnershipError`. Otherwise a conversation id arriving on a request would let any caller read and extend somebody else's thread. Ownership is read off the `userId` your store reports in `list()`; threads that carry no owner stay resumable by whoever holds the id, so ids minted before this check keep working.

`MemoryConversationStore` is in-process and loses every thread on restart, so it is for tests and dev only. For production, **implement the `ConversationStore` contract against your own database** (Postgres, Redis, an external service). It is five methods:

```ts
interface ConversationStore {
  create(title?: string, meta?: ConversationStoreMeta): Promise<string>
  load(conversationId: string): Promise<AiMessage[]>
  append(conversationId: string, messages: AiMessage[]): Promise<void>
  setTitle(conversationId: string, title: string): Promise<void>
  list(userId?: string): Promise<ConversationStoreListEntry[]>
  delete?(conversationId: string): Promise<void>   // optional
}
```

`ConversationStoreMeta` carries `userId`, an optional `agent` thread-segregation key (see [Auto-persist](#auto-persist-conversational) below), and free-form `resourceSlug` / `recordId` fields your backend can index on.

Mirror that `userId` back onto the entries your `list()` returns (`ConversationStoreListEntry.userId`). It is the only owner-aware read in the contract, so it is what the resume-by-id owner check consults; a store that omits it cannot be enforced and stays as permissive as it was.

### Sanitizing loaded history

A thread interrupted mid-turn (a crash after the assistant row landed but before its tool-result rows) replays into a provider `400`: a dangling `tool_use` on Anthropic, an orphan `role: 'tool'` on OpenAI-compatible providers. `sanitizeConversation()` drops the incomplete turns so any loaded history is replay-safe. It is a pure, idempotent function exported from `@gemstack/ai-sdk`, so your custom store should run loaded history through it in `load()`:

```ts
import { sanitizeConversation } from '@gemstack/ai-sdk'

async load(conversationId: string) {
  const messages = await this.readFromBackend(conversationId)
  return sanitizeConversation(messages)
}
```

## Auto-persist (`conversational()`)

For chat-style agents, threading `forUser()` through every call site is a footgun - forget it once and the conversation silently does not persist. Override `conversational()` on the agent class to auto-load + auto-save without each caller passing the user id:

```ts
class ChatAgent extends Agent {
  conversational() {
    return { user: currentUserId }   // falsy user -> opt-out
  }
}

await new ChatAgent().prompt('Hi')          // auto-loads thread, runs, auto-saves
await new ChatAgent().prompt('Still you?')  // resumes the same thread
```

Each `(user, agent class)` pair gets its own thread, so a user can talk to a `ChatAgent` and a `SupportAgent` without their histories merging. The segregation key defaults to the class name; override it with `agent: 'custom'` if you ever rename the class.

Async returns are awaited - useful when the user identity comes from an async lookup:

```ts
conversational() { return Promise.resolve({ user: await loadUserId() }) }
```

For long-running threads, cap loaded history to the last N messages:

```ts
conversational() { return { user: userId, historyLimit: 50 } }
```

Per-call override and explicit-form precedence (high to low):

1. `agent.forUser(id).prompt()` / `agent.continue(id).prompt()` - explicit always wins.
2. `agent.prompt(input, { conversation: false | { user, id?, historyLimit? } })` - per-call.
3. `agent.conversational()` - class declaration.

Whichever layer supplies the `id`, the owner check applies: the resolved `user` must match the thread's stored owner.

Stores that surface the `agent` meta in `list()` results get the per-class thread separation; stores that ignore it fall back to "always create a new thread", which is the conservative behavior.

## Validating continuations (`validate`)

A continuation after a client-tool or approval round-trip carries the prior messages back from the browser, so the server is trusting client-supplied history. Without a guard a caller can rewrite that history (continue another user's thread, an IDOR), forge a `tool` result for a tool the server never ran, or claim an approval that was never pending.

Pass a `validate` hook through the prompt options. It runs against the server-persisted history just before the agent loop, and throwing rejects the request. `defaultContinuationValidator()` is the built-in gate (prefix equality + tool-result-forgery + approval-forgery):

```ts
import { defaultContinuationValidator } from '@gemstack/ai-sdk'

await agent
  .continue(conversationId)
  .prompt(input, {
    messages,                                  // client-supplied continuation
    validate: defaultContinuationValidator(),  // throws ContinuationValidationError on forgery
  })
```

The same hook fires on the auto-persist path (`conversational()`) and on the streaming variant. For custom policy, the lower-level `validateContinuation(persisted, incoming, opts?)` returns a `{ ok, code, reason, index }` verdict you can branch on instead of throwing; `assertValidContinuation(...)` throws on failure. Rejection codes (`ContinuationRejectionCode`) discriminate `not-a-prefix` (history rewrite / IDOR), forged tool results, and forged approvals. Stateless calls (no persistence) never invoke it. The prefix comparison is order-insensitive for nested objects, so a tool-call `arguments` map that came back from storage with its keys reordered (Postgres `jsonb` does this) is not mistaken for a forgery.

## User memory

Conversation persistence remembers *messages*. **User memory** persists *facts* - things about a user that should travel across conversations, separate from any single thread. Useful when the agent needs to remember "Alice's project is named Foo" in a brand-new session without replaying the prior history.

The contract is the `UserMemory` interface; the engine ships one in-memory implementation, `MemoryUserMemory`:

```ts
import { setUserMemory, MemoryUserMemory } from '@gemstack/ai-sdk'

setUserMemory(new MemoryUserMemory())   // in-memory default: dev / tests
```

`MemoryUserMemory` is Map-backed and uses case-insensitive **token-overlap** recall: the query is tokenized on non-alphanumeric boundaries and any fact sharing a token (>= 3 chars) with the query is returned, in insertion order. It is for tests and dev; for production **implement the `UserMemory` contract against your own database** (and add a semantic backend on top with embeddings - see below).

### The `UserMemory` interface

```ts
interface UserMemory {
  remember(userId: string, fact: string,  opts?: { tags?: string[]; score?: number }): Promise<MemoryEntry>
  recall  (userId: string, query: string, opts?: { limit?: number;  tags?: string[] }): Promise<MemoryEntry[]>
  forget  (userId: string, factId: string                                            ): Promise<void>
  list    (userId: string,                opts?: { tags?: string[]; limit?: number  }): Promise<MemoryEntry[]>
  forgetAll?(userId: string): Promise<void>           // optional GDPR cascade
}
```

A `MemoryEntry` is `{ id, userId, fact, tags?, score?, createdAt, updatedAt? }`. The `score` is an optional confidence in `[0, 1]`; auto-extract sets it from the model's self-rating, manual `remember()` calls may omit it, and `recall()` ranking is implementation-defined when scores are absent.

The interface is intentionally narrow so substring-match, full-text, and vector backends all satisfy it. **Semantic recall** (matching "Where do I deploy?" against "Project Foo lives at fly.io") is just a `UserMemory` implementation whose `recall()` embeds the query with `AI.embed(...)` and ranks facts by cosine similarity - see [Vector Stores & RAG](/packages/ai-sdk/rag) for the embedding surface to build that on. When you wire an external vector store, remember that `forget()` / `forgetAll()` must cascade to it yourself.

Manual API - drop-in for any agent flow:

```ts
const mem = new MemoryUserMemory()
await mem.remember('user_123', 'Project name is Foo', { tags: ['project'] })
const facts = await mem.recall('user_123', 'project')
//=> [{ id: '...', userId: 'user_123', fact: 'Project name is Foo', tags: ['project'], createdAt: ... }]
```

### Auto-inject + auto-extract via `Agent.remembers()`

For the common case - a chat agent that should both pull relevant facts into its system prompt AND distill new facts from each turn - declare `remembers()` on the class. The framework installs the right middleware automatically (it resolves the registered `UserMemory` via `setUserMemory()`):

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user:               currentUserId,
      inject:             'auto',                       // recall + prepend per turn
      extract:            'auto',                       // distill new facts per turn
      extractWith:        'anthropic/claude-haiku-4-5', // small model for distillation
      tags:               ['support'],                  // recall + extract scope
      injectLimit:        5,                            // cap injected facts
      injectTokenBudget:  400,                          // hard token cap; lowest-score drops first
    }
  }
}
```

**Auto-inject** prepends matching facts as a fenced `<user-memory>` block to the system message:

```text
You are a support agent.

<user-memory>
- Project Foo deploys to fly.io us-east
- prefers TypeScript strict mode
</user-memory>
```

The block is built by querying `mem.recall(spec.user, latestUserText, { limit, tags })` once per turn (the `onStart` middleware), then trimming by `injectTokenBudget` if set. Token budget drops the lowest-score facts first.

**Auto-extract** runs after each successful turn - the `onFinish` middleware pulls the latest `[user, assistant]` pair, calls the small `extractWith` model with a JSON-mode prompt asking for `{ facts: [{ fact, score, tags? }] }`, filters by confidence threshold (default `0.7`), and writes the survivors via `mem.remember()`. Failures inside auto-extract (network, JSON parse, schema mismatch, store write) are routed through `MemoryExtractOptions.onError` and otherwise swallowed - the parent prompt never breaks because of memory work. Use `MemoryExtractOptions.onExtracted(entries)` for an audit log.

Per-call escape hatches and precedence (high to low):

1. `agent.prompt(input, { memory: false })` - disable for this call.
2. `agent.prompt(input, { memory: { user, inject?, extract?, ... } })` - override the spec for this call.
3. `agent.remembers()` - class declaration.

**Continuation calls** (when `options.messages` is set, e.g. resuming after a client-tool round-trip) skip both inject and extract so the system prompt is not double-augmented and facts are not double-written.

The two middleware are also exported standalone - `withMemoryInject(spec, opts?)` and `withMemoryExtract(spec, opts?)` - if you want to compose them onto an agent by hand instead of declaring `remembers()`.

## Pitfalls

- **Memory poisoning.** Auto-extract trusts the user's own conversation as input - a malicious user can plant adversarial "facts." The default `0.7` confidence threshold is the v1 defense; tighten it for high-risk domains and pair with `MemoryExtractOptions.onExtracted` for an audit log when shipping to production.
- **`forUser()` / `continue()` throw without a store.** Conversation methods need a registered store - call `setConversationStore(...)` before they are used.
- **`remembers()` is a no-op without a store.** Auto-inject and auto-extract resolve the registered `UserMemory` - call `setUserMemory(...)` (or wire your own implementation) first, or nothing is recalled or written.
- **In-memory defaults lose everything on restart.** `MemoryConversationStore` and `MemoryUserMemory` are in-process. Anything you need to survive a restart or share across web processes and workers needs a real backend behind the contract.
- **External vector store cascade.** If a custom `UserMemory` writes vectors to an external store (Pinecone, Weaviate, pgvector), `forget()` / `forgetAll()` only delete the rows you delete - you must implement the cascade to the second store yourself.

## See also

- [Agents](/packages/ai-sdk/agents) - where conversation threads and memory plug in.
- [Vector Stores & RAG](/packages/ai-sdk/rag) - embeddings and retrieval for semantic recall.
