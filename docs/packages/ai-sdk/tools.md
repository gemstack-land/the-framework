# Tools

Tools let an agent call your code. Define a tool with `toolDefinition(...)`, declare its input schema with Zod, and attach a `.server()` handler:

```ts
import { toolDefinition } from '@gemstack/ai-sdk'
import { z } from 'zod'

const searchTool = toolDefinition({
  name:        'search_users',
  description: 'Search users by name or email',
  inputSchema: z.object({
    query: z.string().describe('Name or email substring'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
}).server(async ({ query, limit }) => {
  return db.users.search(query, limit)
})
```

The agent decides when to call tools based on the prompt. Tool calls and results both flow through the response: inspect `response.steps` for the full trace, including each call's `duration` (wall-clock ms spent in the handler).

**Argument validation.** The agent validates each tool call's arguments against `inputSchema` before invoking `.server(...)`, so your handler always receives the parsed value (Zod transforms, defaults, and coercion all apply). When validation fails, the agent feeds an `InvalidToolArgumentsError` back to the model as the tool result so it can correct itself on the next step; your handler never runs with malformed input.

## Streaming tools

A `.server()` handler may be a plain async function or an `async function*` generator. Each `yield` surfaces as a `tool-update` chunk on the agent's stream, so a long-running tool can report progress before it returns its final value:

```ts
const ingest = toolDefinition({
  name:        'ingest',
  description: 'Ingest and index a document',
  inputSchema: z.object({ url: z.string() }),
}).server(async function* ({ url }) {
  yield { status: 'downloading' }
  const doc = await fetchDoc(url)
  yield { status: 'indexing', pages: doc.pages }
  return await index(doc)
})
```

## Parallel execution within a step

When the model emits more than one tool call in a single step, their `.server()` handlers run concurrently by default. Streamed chunk order is still preserved: tool A's `tool-call -> tool-update* -> tool-result` always precedes B's, so consumers see deterministic sequences regardless of which tool finishes first. Approval gates and `onBeforeToolCall` middleware decisions still resolve serially in tool-call order before any handler runs. Opt out when tools share non-idempotent state:

```ts
await agent('...').prompt('go', { parallelTools: false })
```

Or per agent class:

```ts
class CounterAgent extends Agent {
  parallelTools() { return false }
  // ...
}
```

## Client tools

Omit `.server()` and the tool becomes a *client* tool: the agent loop pauses when the model calls it, surfacing the call as `pendingClientToolCalls` on the response so a browser (or any caller) can execute it and resume. This is how you run a capability that only exists on the client (reading the DOM, a local file picker, device APIs) without leaking it to the server.

```ts
const pickFile = toolDefinition({
  name:        'pick_file',
  description: 'Ask the user to choose a local file',
  inputSchema: z.object({ accept: z.string().optional() }),
})
// no .server() - the loop pauses and reports this call to the caller
```

When `response.pendingClientToolCalls` is populated, run the call wherever it belongs, then resume the run with the tool result. The cross-request resume protocol for top-level runs is covered under [Standalone run persistence](/packages/ai-sdk/agents); the streaming SSE wire that carries these pauses is in [Streaming](/packages/ai-sdk/streaming).

## Approval gates

Mark a tool `needsApproval: true` to require a human decision before its handler runs. When the model calls it, the loop pauses with a pending-approval signal instead of executing; the caller approves or rejects, and only an approval lets the handler proceed.

```ts
const refund = toolDefinition({
  name:         'issue_refund',
  description:  'Issue a refund to a customer',
  inputSchema:  z.object({ orderId: z.string(), amount: z.number() }),
  needsApproval: true,
}).server(async ({ orderId, amount }) => {
  return db.refunds.create(orderId, amount)
})
```

Approval decisions resolve serially in tool-call order, ahead of any parallel handler execution. The pause surfaces on the stream as a pending-approval chunk and on the response so a UI can render a confirm card; see [Streaming](/packages/ai-sdk/streaming) for the wire format and [Running agents](/packages/ai-sdk/agents) for resuming an approval-paused run across an HTTP boundary.

## Scoped tools: one tool, many capabilities

Function-calling APIs (OpenAI, DeepSeek, and others) do not reliably honor a top-level `oneOf` in a tool's input schema, so a tool that exposes several distinct capabilities cannot be modeled cleanly as a discriminated union. `scopedTool(...)` collapses N named capability branches into one flat function-call schema with a `sub_tool` discriminator enum, then dispatches to the right branch at call time:

```ts
import { scopedTool, capability } from '@gemstack/ai-sdk'
import { z } from 'zod'

const search = scopedTool({
  name:        'search',
  description: 'Run a search across one of several engines.',
  capabilities: {
    web: capability({
      description: 'Web results',
      input:       z.object({ query: z.string(), page: z.number().optional() }),
      handler:     async ({ query }) => webSearch(query),
    }),
    images: capability({
      description: 'Image results',
      input:       z.object({ query: z.string(), safe: z.boolean() }),
      handler:     async ({ query, safe }) => imageSearch(query, safe),
    }),
  },
})
```

The generated schema is a single object: the discriminator (`sub_tool: 'web' | 'images'`) plus the union of every branch's fields. A field is top-level `required` only when every branch requires it (here `query`); fields that belong to a subset of branches (here `safe`) are optional at the top level and annotated with the capabilities that use them, and the chosen branch's required fields are validated in code before its handler runs. An unknown or disabled discriminator value is rejected with a clear `ScopedToolError` the model can correct on its next step.

- `capability({ input, handler, description? })` infers each branch's input type so the `handler` parameter is typed without annotation. Handlers may be plain async functions or `async function*` generators (which stream `tool-update` chunks, exactly like `.server()`).
- `discriminator` overrides the field name (default `'sub_tool'`).
- `allow: ['web']` exposes only a subset of declared capabilities: both the enum and the runtime dispatch honor it (per-plan gating).

`scopedTool(...)` returns a normal server tool, so it drops straight into an agent's `tools()` array alongside `toolDefinition(...)` tools. The lower-level `flattenCapabilities(...)` is exported for inspecting or unit-testing the generated flat plan directly.

## Pitfalls

- **Tool handlers throwing.** The agent gets the error message back as the tool result. Catch known errors inside the handler and return a structured failure shape instead of throwing.
- **Non-idempotent parallel tools.** Handlers in one step run concurrently by default. Set `parallelTools: false` when they share mutable state.
- **Client tools need a resume path.** A tool with no `.server()` pauses the loop; the run only completes once the caller returns its result. See [Running agents](/packages/ai-sdk/agents).
