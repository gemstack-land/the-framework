# Running agents

An agent is a system prompt plus a model, an optional tool set, and an optional stop condition. You define it once and run it with `.prompt()` (await the full result) or `.stream()` (iterate chunks). This page covers the agent shapes, multi-step loops, sub-agents, suspend/resume across HTTP boundaries, queued background runs, and middleware. For the tool surface itself see [Tools](/packages/ai-sdk/tools); for the stream protocol see [Streaming](/packages/ai-sdk/streaming).

All examples assume a default provider is registered once at startup:

```ts
import { AiRegistry, AnthropicProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

## Three agent shapes

Pick whichever reads best at the call site:

```ts
import { agent, AI, Agent, stepCountIs } from '@gemstack/ai-sdk'

// Inline, one-off
const r1 = await agent('You summarize text.').prompt('Summarize this...')

// Facade with the default model
const r2 = await AI.prompt('Hello world')

// Configured anonymous agent - tools + options together
const r3 = await agent({
  instructions: 'You help find users.',
  model:        'anthropic/claude-sonnet-4-6',
  tools:        [searchTool],
}).prompt('Find all admins')

// Reusable typed class
class SearchAgent extends Agent {
  instructions() { return 'You help find users.' }
  model()        { return 'anthropic/claude-sonnet-4-6' }
  tools()        { return [searchTool] }
  stopWhen()     { return stepCountIs(5) }
}
const r4 = await new SearchAgent().prompt('Find all admins')
```

The `agent({ ... })` form accepts `instructions`, `model`, `tools`, and `middleware`. Anything beyond that (a stop condition, parallel-tool policy, caching, conversation memory) is declared by subclassing `Agent` and overriding the matching method.

## Multi-step agents

By default an agent does one round-trip: prompt, tool calls, final answer. For multi-step reasoning, set a stop condition by overriding `stopWhen()`:

```ts
import { Agent, stepCountIs } from '@gemstack/ai-sdk'

class Researcher extends Agent {
  instructions() { return 'You research and summarize topics.' }
  tools()        { return [searchWeb, fetchPage] }
  stopWhen()     { return stepCountIs(10) }   // up to 10 tool-calling rounds
}

await new Researcher().prompt('Research the transformer architecture.')
```

The built-in stop-condition combinators are `stepCountIs(n)` and `hasToolCall(name)`. For anything else, return a plain `StopCondition` predicate, `({ steps }) => boolean`, from `stopWhen()`. Returning an array applies them with OR semantics (the loop stops when any matches).

## Sub-agents

A tool's handler can itself invoke another agent. Streaming progress and approval state propagate upstream so the parent agent's UI stays in sync.

The shortest path is `agent.asTool({ name, description })`, which wraps an agent as a tool the parent can call. The sub-agent runs its own loop end-to-end (its own model, tools, middleware) and returns a single result.

```ts
const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
})

class Orchestrator extends Agent {
  tools()    { return [research] }
  stopWhen() { return stepCountIs(5) }
}

await new Orchestrator().prompt('Summarize the transformer paper.')
```

Defaults are tuned for the zero-config case: `inputSchema` is `{ prompt: string }` and the parent model only sees `response.text` on its next step. The UI still receives the full `AgentResponse` via the `tool-result` chunk, so dashboards can render rich sub-agent transcripts without bloating the parent's context.

For a typed input schema, pass `inputSchema` + `prompt`:

```ts
new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
  inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
  prompt:      ({ topic, depth }) => `Research ${topic} at ${depth} depth.`,
  modelOutput: (r) => `${r.steps.length} step(s); ${r.text.slice(0, 280)}`,
})
```

### Streaming sub-agent progress

Pass `streaming: true` to surface inner-agent progress as `tool-update` chunks on the parent's stream. The default projection emits `agent_start` once, `tool_call` per inner tool call, and `agent_done` once when the sub-agent finishes:

```ts
const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
  streaming:   true,
})

const { stream } = agent({ tools: [research] }).stream('summarize that paper')
for await (const chunk of stream) {
  if (chunk.type === 'tool-update' && chunk.update?.kind === 'tool_call') {
    console.log(`subagent calling ${chunk.update.tool}`)
  }
}
```

For a different cadence (surfacing inner `text-delta` as preview text, or per-step usage), pass a projector:

```ts
streaming: (chunk) => chunk.type === 'finish'
  ? { kind: 'agent_step', step: ++n, tokens: chunk.usage?.totalTokens ?? 0 }
  : null
```

### Suspend and resume: sub-agents that pause

A sub-agent's loop pauses in two cases the parent loop has to surface upward: when the model emits a *client* tool call (one with no `.server()` handler) and when a sub-agent's tool with `needsApproval: true` fires. Pass `suspendable: { runStore }` to opt into the propagation protocol; `asTool` handles both pauses symmetrically.

The run store is a neutral contract. `InMemorySubAgentRunStore` works for tests and single-process dev; `CachedSubAgentRunStore` is an adapter over any `CacheAdapter` you supply (Redis, Memcached, a `Map`, your framework's cache) for cross-process / cross-restart persistence. `@gemstack/ai-sdk` bundles no cache implementation, so you bring the cache:

```ts
import { CachedSubAgentRunStore } from '@gemstack/ai-sdk'

const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research with browser-side tools and approval-gated actions.',
  streaming:   true,                                          // suspend requires streaming
  suspendable: { runStore: new CachedSubAgentRunStore({ cache }) },
})
```

When the sub-agent pauses, `asTool` snapshots its message history and yields a suspend update plus a control chunk that halts the parent loop. The snapshot's `pauseKind` discriminator tells the host which resume contract applies:

| Inner `finishReason` | `SubAgentUpdate` emitted | Snapshot `pauseKind` | Parent halts with |
|---|---|---|---|
| `'client_tool_calls'` | `subagent_paused` | `'client_tool'` | `pendingClientToolCalls` |
| `'tool_approval_required'` | `subagent_paused_approval` | `'approval'` | `pendingApprovalToolCall` |

The host's continuation endpoint resumes via `Agent.resumeAsTool`:

```ts
import { Agent } from '@gemstack/ai-sdk'

// Client-tool pause - pass tool results from the browser
const r = await Agent.resumeAsTool(subRunId, browserResults, {
  runStore,
  agent: rebuiltSubAgent,   // host rebuilds the sub-agent context per resume
})

// Approval pause - pass the user's decision
const r2 = await Agent.resumeAsTool(subRunId, [], {
  runStore,
  agent: rebuiltSubAgent,
  approvedToolCallIds: ['inner-call-id'],   // or rejectedToolCallIds
})

if (r.kind === 'completed') {
  // feed r.response.text back into the parent's tool result
} else {
  // r.kind === 'paused' - r.pauseKind ('client_tool' | 'approval') routes the
  // next upstream event; r.toolCall + r.isClientTool are populated for approval
  // pauses so renderers can show a fresh approval card.
}
```

A resume can pause again on a different kind than it started on (an approval that, once granted, leads the inner agent to emit a client tool call). The `pauseKind` field on `'paused'` returns lets the host route correctly without inspecting the snapshot. Suspend without streaming throws at builder time: silent suspend is a UX trap.

When an orchestrator dispatches several sub-agents in one parent turn and more than one pauses, `Agent.resumeManyAsTool(requests, { runStore })` resumes them as a batch and aggregates their pending tool calls into a single client round-trip:

```ts
let batch = await Agent.resumeManyAsTool(
  paused.map(p => ({
    subRunId:          p.subRunId,
    agent:             rebuildSubAgent(p),
    clientToolResults: resultsBySubRun[p.subRunId],   // or approved/rejectedToolCallIds
    key:               p.subRunId,                    // echoed back for correlation
  })),
  { runStore },
)

// batch.completed / batch.paused / batch.errors partition the outcomes;
// batch.pendingToolCallIds is the combined set to gather the next round for.
// Re-call with each paused item's NEW subRunId until batch.allCompleted.
```

Options: `onError: 'capture'` (default; a bad item becomes a `{ kind: 'error' }` outcome and the rest still resume) or `'throw'`; `concurrency: 'parallel'` (default) or `'serial'`. Pass `streaming` (with `onUpdate`) to keep each resumed sub-agent's progress live rather than freezing its bubble until it completes or pauses again.

### Standalone run persistence: a top-level `stream()` that pauses

The sub-agent run store covers pauses *inside* a parent loop. A top-level `agent.stream()` pauses for the same two reasons (a client tool with no handler, or an approval gate) but across an HTTP boundary: the run stops on one request and resumes on the next. Persist the run state between them with `CachedAgentRunStore`, the standalone sibling, also an adapter over a `CacheAdapter` you supply:

```ts
import { CachedAgentRunStore, newAgentRunId, type AgentRunState } from '@gemstack/ai-sdk'

const runs = new CachedAgentRunStore({ cache })

// First request - the stream pauses on a client tool:
const { stream, response } = agent({ tools: [browserTool] }).stream(input)
for await (const _ of stream) { /* forward chunks to the client */ }
const res = await response

if (res.pendingClientToolCalls?.length) {
  const runId = newAgentRunId()
  await runs.store(runId, {
    messages:           conversationSoFar,                   // full history to replay
    pendingToolCallIds: res.pendingClientToolCalls.map(c => c.id),
    stepsSoFar:         res.steps.length,
    tokensSoFar:        res.usage.totalTokens,
    meta:               { userId },                          // opaque, never read by the engine
  })
  return { runId, pending: res.pendingClientToolCalls }      // hand runId to the client
}
```

```ts
// Follow-up request - the client returns tool results for `runId`:
const state = await runs.consume(runId)   // atomic single-use: a replayed runId can't read twice
if (!state) throw new Error('run expired or already resumed')

await agent({ tools: [browserTool] })
  .stream(/* original input */, { messages: [...state.messages, ...toolResultMessages] })
```

`store` / `load` / `consume` are the three operations: `load()` is a non-destructive peek (render a "waiting for approval" view on a GET without burning the run), `consume()` is the atomic read-and-delete you call on the actual resume. `AgentRunState` carries `pauseKind` (`'client_tool'` | `'approval'`) and `pendingApprovalToolCall` so approval pauses round-trip the same way. `newAgentRunId()` mints an unguessable id (a `runId` is a capability handle to a parked conversation). `InMemoryAgentRunStore` is the test / single-process backend.

### Hand-rolled sub-agent tools

For full control (a custom progress shape, sub-agent token-deltas as `tool-update` chunks, anything outside the `asTool` envelope), write the wrapping tool by hand:

```ts
const research = toolDefinition({
  name:        'research',
  description: 'Research a topic in depth',
  inputSchema: z.object({ topic: z.string() }),
}).server(async ({ topic }) => {
  return await new ResearchAgent().prompt(topic)
})
```

For Model Context Protocol bridging (consuming remote MCP tools in an agent, or exposing an agent as an MCP server), see [/packages/ai-mcp](/packages/ai-mcp). For higher-level multi-agent orchestration patterns built on this runtime, see [/packages/ai-autopilot](/packages/ai-autopilot).

## Chat mentions (`@slug` agent routing)

In a chat UI where one orchestrator routes to several agents, let users `@<slug>` an agent to invoke it explicitly, overriding the orchestrator's own judgment. `@gemstack/ai-sdk/chat-mentions` ships the two reusable pieces:

```ts
import { parseMentions, buildMentionRoutingRule } from '@gemstack/ai-sdk/chat-mentions'

const { slugs, cleaned } = parseMentions(userMessage, knownAgentSlugs)
// '@seo audit this' → { slugs: ['seo'], cleaned: 'audit this' }

const rule = buildMentionRoutingRule(slugs)   // null when no mentions
if (rule) systemPrompt += `\n\n${rule}`
// then run the orchestrator with `cleaned` as the user input
```

`parseMentions` validates tokens against your known slugs (unknown `@mentions` stay as plain text), dedupes in first-seen order, and strips the matched tokens so the model sees only the cleaned intent. It does not treat `email@host` as a mention. `buildMentionRoutingRule` renders a system-prompt rule forcing the orchestrator to dispatch the mentioned agents in order; pass `{ toolName, argKey }` if your dispatch tool is not the default `run_agent({ agentSlug })`.

## Queued prompts

Push an agent run onto a background queue. `agent.queue(input)` returns a `QueuedPromptBuilder` so you can pick a queue, attach success/failure callbacks, and optionally stream progress to a broadcast channel as it runs.

The queue and broadcast transports are neutral contracts you register once at startup with `configureAiQueue`; `@gemstack/ai-sdk` bundles no queue or broadcast implementation, so you bring your own:

```ts
import { configureAiQueue } from '@gemstack/ai-sdk'

configureAiQueue({
  dispatch:  (fn) => myQueue.push(fn),          // enqueue fn to run on a worker
  broadcast: (channel, event, data) => myBus.publish(channel, event, data),  // optional
})
```

```ts
// Fire-and-forget background run
await new SupportAgent()
  .queue('Help with refund request')
  .onQueue('ai')
  .send()

// With success/failure callbacks
await new ResearchAgent()
  .queue('Research the latest architecture')
  .then(response => console.log('Done:', response.text))
  .catch(error  => console.error('Failed:', error))
  .send()
```

### Stream progress to a broadcast channel

Background AI work plus a live UI without polling. Each stream chunk is broadcast to the channel as the job runs; the final response is broadcast as a `done` event. This needs a `broadcast` adapter registered via `configureAiQueue`.

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()
```

Subscribers on `user.${userId}.support` receive:

- `{ event: 'chunk', data: <StreamChunk> }` - one per stream chunk (text-delta, tool-call, tool-result, ...)
- `{ event: 'done',  data: <AgentResponse> }` - final result, after the agent loop ends
- `{ event: 'error', data: { message } }` - on failure

The chunk shape matches the engine's normal `StreamChunk` types, so a frontend can subscribe to the channel and reuse its existing chunk-handling code. Pass `eventPrefix` to namespace events when the channel carries other unrelated messages:

```ts
.broadcast('shared-channel', { eventPrefix: 'agent.' })
// emits 'agent.chunk', 'agent.done', 'agent.error'
```

## Middleware

Middleware is an `AiMiddleware` interface: implement only the lifecycle hooks you care about. Hooks include `onConfig`, `onStart`, `onIteration`, `onChunk`, `onBeforeToolCall`, `onAfterToolCall`, `onToolPhaseComplete`, `onUsage`, `onFinish`, `onAbort`, and `onError`.

```ts
import type { AiMiddleware } from '@gemstack/ai-sdk'

const logging: AiMiddleware = {
  name: 'logging',
  onStart(ctx)     { console.log(`[ai] ${ctx.model} started`) },
  onUsage(_ctx, u) { console.log(`[ai] ${u.totalTokens} tokens`) },
  onBeforeToolCall(_ctx, name) {
    if (name === 'dangerous_tool') return { type: 'skip', result: 'Tool disabled' }
    return undefined
  },
  onChunk(_ctx, chunk) { return chunk },   // transform, or return null to drop
}

await agent({ instructions: 'You are helpful.', middleware: [logging] }).prompt('Hello')
```

`onBeforeToolCall` can return `{ type: 'skip', result }` to short-circuit a tool, `{ type: 'transformArgs', args }` to rewrite arguments, or `{ type: 'abort', reason }` to stop the loop. For run telemetry without writing middleware, subscribe to the observer registry from `@gemstack/ai-sdk/observers`.

## Pitfalls

- **Streaming `response` not resolving.** `await response` only resolves after the `stream` iterator has been fully consumed. Always iterate the stream first, even if you only care about the final result.
- **Bare model names.** `model: 'claude-sonnet-4-6'` throws; it must be `provider/model`.
- **Suspend needs a run store and streaming.** `suspendable` requires `streaming` on `asTool`, and the cache-backed stores require a `CacheAdapter` you supply.
