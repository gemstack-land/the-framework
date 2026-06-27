# Your First Agent

This walkthrough assumes you have [installed](/guide/installation) `@gemstack/ai-sdk` and registered a provider.

## A one-line prompt

```ts
import { agent } from '@gemstack/ai-sdk'

const response = await agent('You are a helpful assistant.')
  .prompt('Summarize the transformer architecture in one sentence.')

console.log(response.text)
```

`agent(instructions)` returns an agent; `.prompt(input)` runs it and resolves to an `AgentResponse` with `.text`, `.steps`, `.usage`, and more.

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
  model: 'anthropic/claude-sonnet-4-6',
  tools: [searchTool],
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

A class is the right shape once an agent has tools, a fixed model, middleware, or memory - everything lives in one place and the type is reusable.

## Giving the agent a tool

Tools let the agent call your code. Define one with `toolDefinition(...)`, declare its input with Zod, and attach a `.server()` handler:

```ts
import { agent, toolDefinition } from '@gemstack/ai-sdk'
import { z } from 'zod'

const searchTool = toolDefinition({
  name:        'search_users',
  description: 'Search users by name or email',
  inputSchema: z.object({
    query: z.string().describe('Name or email substring'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
}).server(async ({ query, limit }) => {
  return await db.users.search(query, limit)
})

const response = await agent({
  instructions: 'You help find users.',
  tools: [searchTool],
}).prompt('Find all admins')
```

The agent decides when to call the tool, validates the arguments against `inputSchema` before your handler runs, and feeds the result back to the model. Inspect `response.steps` for the full trace.

## Where to go next

| You want to… | Read |
|---|---|
| Understand the agent loop, sub-agents, multi-step runs | [Agents](/packages/ai-sdk/agents) |
| Go deeper on tools, scoped tools, client tools, approval gates | [Tools](/packages/ai-sdk/tools) |
| Stream tokens and tool progress to a UI | [Streaming](/packages/ai-sdk/streaming) |
| Get typed objects back instead of text | [Structured Output](/packages/ai-sdk/structured-output) |
| Persist conversations and give the agent memory | [Memory & Persistence](/packages/ai-sdk/memory) |
| Retrieval-augmented generation over your documents | [Vector Stores & RAG](/packages/ai-sdk/rag) |
| Test agents without hitting a real model | [Testing & Evals](/packages/ai-sdk/testing) |
