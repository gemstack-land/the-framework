# @rudderjs/ai

## Overview

AI engine for Rudder providing a provider-agnostic agent framework with tool calling, streaming, middleware, attachments, conversation persistence, structured output, and queued execution. Supports Anthropic, OpenAI, Google, Ollama, DeepSeek, xAI, Groq, Mistral, and Azure OpenAI out of the box. Models are addressed via `provider/model` strings (e.g. `anthropic/claude-sonnet-4-5`), and the `AiRegistry` handles provider resolution and failover.

## Key Patterns

### Creating Agents

Extend the `Agent` class for reusable agents, or use `agent()` for inline one-offs:

```ts
class SearchAgent extends Agent implements HasTools, HasMiddleware {
  instructions() { return 'You are a search assistant.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  tools() { return [searchTool] }
  middleware() { return [loggingMiddleware] }
}
const response = await new SearchAgent().prompt('Find users named John')

// Inline agents
await agent({ instructions: 'You are helpful.', tools: [weatherTool] }).prompt('Hello')
await agent('You are helpful.').prompt('Hello') // simplest form
```

### Using Providers (Anthropic, OpenAI, Google, etc.)

Configure providers in `config/ai.ts`. The Node-only `AiProvider` lives at `@rudderjs/ai/server` (the main `@rudderjs/ai` entry is runtime-agnostic and has no provider class):

```ts
// config/ai.ts — providers: anthropic, openai, google, ollama, deepseek, xai, groq, mistral, azure, openrouter, bedrock
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai:    { apiKey: process.env.OPENAI_API_KEY },
    ollama:    { driver: 'ollama', baseUrl: 'http://localhost:11434' },
  },
} satisfies AiConfig

// bootstrap/providers.ts
import { AiProvider } from '@rudderjs/ai/server'
export default [AiProvider]
```

Provider auto-discovery (`defaultProviders()`) finds `AiProvider` automatically via the `rudderjs.providerSubpath` field in `@rudderjs/ai/package.json` — no manual subpath import needed when using auto-discovery.

Agents support failover: `failover() { return ['openai/gpt-4o'] }`. The same pattern is on the media generators: `ImageGenerator.of('...').model('openai/dall-e-3').failover('google/imagen-3').generate()` (also `AudioGenerator`, `Transcription`).

**Prompt caching.** Mark stable parts of the prompt as cacheable — providers translate to native primitives (Anthropic `cache_control`, OpenAI `prompt_cache_key`, Google `cachedContent`).

```ts
class SupportAgent extends Agent {
  cacheable() { return { instructions: true, tools: true, messages: 2 } }
  //                                                       ^ cache first 2 messages
}
```

Per-call override: `agent.prompt(input, { cache: false })` to disable; `{ cache: {...} }` to replace. All three big providers (Anthropic, OpenAI, Google) are wired up. The `ttl` field is Google-only and defaults to `'1h'`; Anthropic and OpenAI ignore it.

### Tools

Define tools with Zod schemas. Tools are either `server` (executed on backend) or `client` (forwarded to frontend):

```ts
const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
}).server(async ({ location }) => ({ temp: 72, unit: 'F', location }))
```

### Subagents (`agent.asTool()`)

Wrap one agent as a tool another agent can call. Defaults: `inputSchema = { prompt: string }`, `modelOutput = response.text`. Pass `inputSchema` + `prompt` for a typed schema.

```ts
class Planner extends Agent implements HasTools {
  instructions() { return 'You break work into steps. Use `research` for facts.' }
  tools() {
    return [
      new ResearchAgent().asTool({
        name:        'research',
        description: 'Research a topic in depth.',
      }),
    ]
  }
}
```

By default the subagent runs via `prompt()` (non-streaming). Pass `streaming: true` to surface inner progress as `tool-update` chunks (default projection emits `agent_start` / `tool_call` / `agent_done`, plus `agent_pending_approval` for inner approval gates); pass `(chunk) => SubAgentUpdate | null` for a custom projector. To propagate inner pauses upward through the parent loop, also pass `suspendable: { runStore }` (suspend without streaming throws at builder time) — `asTool` handles BOTH client-tool pauses AND approval pauses symmetrically, persisting a snapshot with a `pauseKind: 'client_tool' | 'approval'` discriminator. The host's continuation calls `Agent.resumeAsTool(subRunId, results, { runStore, agent })` for client-tool resumes, or `Agent.resumeAsTool(subRunId, [], { runStore, agent, approvedToolCallIds: [...] })` (or `rejectedToolCallIds`) for approval resumes. The returned `'paused'` variant carries `pauseKind` so the host can route the next round-trip correctly. `InMemorySubAgentRunStore` works for tests; `CachedSubAgentRunStore` plugs into `@rudderjs/cache` for multi-worker persistence.

### Middleware

Middleware hooks into the agent loop lifecycle. Hooks: `onConfig`, `onStart`, `onIteration`, `onChunk`, `onBeforeToolCall`, `onAfterToolCall`, `onToolPhaseComplete`, `onUsage`, `onAbort`, `onError`, `onFinish`.

```ts
const loggingMiddleware: AiMiddleware = {
  onStart(ctx) { console.log(`[AI] Request ${ctx.requestId} started`) },
  onUsage(ctx, usage) { console.log(`[AI] Tokens: ${usage.totalTokens}`) },
  onBeforeToolCall(ctx, toolName, args) {
    if (toolName === 'dangerous_tool') return { type: 'skip', result: 'Tool disabled' }
    return undefined // continue normally
  },
  onChunk(ctx, chunk) { return chunk }, // transform or return null to drop
}
```

### Attachments

Send images and documents alongside prompts. The main entry has runtime-agnostic factories (`fromBase64`, `fromUrl`, `fromString`); for path-based loading import from `@rudderjs/ai/node`:

```ts
import { Image, Document } from '@rudderjs/ai'
import { imageFromPath } from '@rudderjs/ai/node'

const img = await imageFromPath('./screenshot.png')          // Node-only
const doc = await Document.fromUrl('https://example.com/report.pdf')

await myAgent.prompt('Describe this image and summarize the doc', {
  attachments: [img.toAttachment(), doc.toAttachment()],
})
```

### Conversations

Persist multi-turn conversations with `ConversationStore`. Register via `setConversationStore()` or pass `conversations` in AI config:

```ts
setConversationStore(new MemoryConversationStore())
const response = await myAgent.forUser('user-123').prompt('Hello')  // creates conversation
const follow = await myAgent.forUser('user-123').continue(response.conversationId).prompt('Follow up')
```

Keep `forUser()` on the resume: a thread may only be resumed by the user it was created for, and a mismatch (including a bare `continue()` with no user) throws `ConversationOwnershipError`. Threads stored without a `userId` stay open to whoever holds the id.

For chat agents that should always auto-persist for the active user, override `conversational()` on the class — `agent.prompt(input)` then auto-loads + auto-saves without each caller passing the user id:

```ts
class ChatAgent extends Agent {
  conversational() { return { user: Auth.user()?.id } }   // null user → opt-out
}
await new ChatAgent().prompt('Hi')          // auto-loads thread
await new ChatAgent().prompt('still you?')  // resumes per (user, class)
```

Returning `false` (default) keeps the agent stateless. Optional `historyLimit: N` caps loaded messages. Per-call `{ conversation: false }` opts out; `forUser`/`continue` always win.

### Streaming

Use `.stream()` for real-time token delivery:

```ts
const { stream, response } = myAgent.stream('Write a story')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '')
  if (chunk.type === 'tool-call') console.log('Tool called:', chunk.toolCall)
}

const final = await response // full AgentResponse after stream ends
```

### MCP integration (`@rudderjs/ai/mcp`)

Bridge agents and Model Context Protocol servers in both directions. Optional peer: `@modelcontextprotocol/sdk`.

**Consume MCP tools in an agent:**

```ts
import { mcpClientTools } from '@rudderjs/ai/mcp'

const tools = await mcpClientTools('https://api.example.com/mcp')
// or: await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })

class ResearchAgent extends Agent {
  instructions() { return 'You can call remote MCP tools.' }
  tools() { return tools }
}
```

**Expose an agent as an MCP server** (callable from Claude Desktop, Cursor, etc.):

```ts
import { mcpServerFromAgent } from '@rudderjs/ai/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Default: each agent.tools() entry becomes an MCP tool
const server = await mcpServerFromAgent(MyAgent)

// Or expose the whole agent as one prompt-tool
const promptServer = await mcpServerFromAgent(MyAgent, { expose: 'agent' })

await server.connect(new StdioServerTransport())
```

When mcpClientTools owns the underlying client (URL or stdio transport), the returned array exposes `close()` for shutdown — call it when the agent is done. With a caller-provided client, lifecycle stays with the caller.

### Queued prompts + live broadcast (`agent.queue().broadcast()`)

`agent.queue(input)` ships the run to the background queue (`@rudderjs/queue`). Add `.broadcast(channel)` to stream chunks to a `@rudderjs/broadcast` channel as the job runs — background AI work + live UI without polling.

```ts
import { agent } from '@rudderjs/ai'

// Plain queued — no live updates
await agent('You help with refunds.')
  .queue('Process refund for order #1234')
  .onQueue('ai')
  .send()

// Stream chunks to the user's channel as they arrive
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()
```

Subscribers on the channel receive `chunk` events (one per `StreamChunk`), then a `done` event with the final `AgentResponse`, or an `error` event on failure. Optional `eventPrefix` namespaces events: `.broadcast('chan', { eventPrefix: 'agent.' })` emits `agent.chunk` / `agent.done` / `agent.error`.

`@rudderjs/broadcast`'s in-process WS state is process-local — same-process web + `queue:work` works out of the box; a separate worker process needs a future pub/sub bridge.

### Structured Output

Use `Output` to constrain responses to typed schemas:

```ts
import { Output } from '@rudderjs/ai'

const sentiment = Output.choice({ options: ['positive', 'negative', 'neutral'] as const })
const extraction = Output.object({ schema: z.object({ name: z.string(), age: z.number() }) })
const items = Output.array({ element: z.object({ title: z.string() }) })
```

## Common Pitfalls

- **Model string format**: Always use `provider/model` (e.g. `anthropic/claude-sonnet-4-5`). A bare model name throws.
- **Optional SDK deps**: Provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) are optional dependencies. Install the ones you need.
- **ConversationStore required for `.forUser()`/`.continue()`**: Call `setConversationStore()` or pass `conversations` in the AI config. Without it, conversation methods throw.
- **Tool loop limits**: `maxSteps()` defaults to 20. If the agent hits the limit it stops silently. Increase it for complex multi-tool workflows.
- **Parallel tool execution**: when the model emits multiple tool calls in a single step, their `execute()` functions run concurrently by default. Streamed chunks still emit in tool-call order. Opt out via `prompt(..., { parallelTools: false })` or override `parallelTools()` on the agent class for tools with non-idempotent shared state.
- **Streaming response access**: `await response` only resolves after the stream is fully consumed. Always iterate the stream first.
- **Embeddings**: Only providers that implement `createEmbedding()` support `AI.embed()`. Currently OpenAI-compatible providers.

## Key Imports

```ts
import { AiProvider } from '@rudderjs/ai/server'           // service provider (Node only)
import { Agent, agent, ConversableAgent } from '@rudderjs/ai'  // agents
import { AI } from '@rudderjs/ai'                          // facade (AI.prompt, AI.agent, AI.embed)
import { toolDefinition } from '@rudderjs/ai'              // tool builder
import { Image, Document } from '@rudderjs/ai'             // attachments
import { MemoryConversationStore, setConversationStore } from '@rudderjs/ai'
import { Output } from '@rudderjs/ai'                      // structured output
import { AiRegistry } from '@rudderjs/ai'                  // provider registry
import { mcpClientTools, mcpServerFromAgent } from '@rudderjs/ai/mcp'  // MCP bridge (Node)
import { stepCountIs, hasToolCall } from '@rudderjs/ai'    // stop conditions
import type { AgentResponse, AiConfig, AiMiddleware, AnyTool, HasTools, HasMiddleware } from '@rudderjs/ai'
```
