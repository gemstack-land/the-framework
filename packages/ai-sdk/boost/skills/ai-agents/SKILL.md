---
name: ai-agents
description: Building AI agents with tools, streaming, conversation memory, approval flows, and middleware in Rudder
license: MIT
appliesTo:
  - '@rudderjs/ai'
trigger: building an `Agent` class, calling `Agent.prompt()`/`.stream()`, defining `tools()` or `middleware()`, or wiring conversations / failover
skip: writing a tool definition by itself — load `ai-tools` instead
metadata:
  author: rudderjs
---

# AI Agents

## When to use this skill

Load this skill when you need to build an AI agent, run prompts with tool loops, stream responses, persist conversations, use approval gates, or queue agent work for background execution.

## Key concepts

- **Agent base class**: Extend `Agent` and implement `instructions()`. Optionally override `model()`, `tools()`, `maxSteps()`, `stopWhen()`, `temperature()`, `middleware()`.
- **Anonymous agents**: Use the `agent()` function for inline, one-off agents without a class.
- **Tool loop**: The agent runs a loop: prompt model -> execute tool calls -> feed results back -> repeat until stop condition.
- **Streaming**: `agent.stream()` returns `{ stream: AsyncIterable<StreamChunk>, response: Promise<AgentResponse> }`.
- **Conversations**: `agent.forUser(id).prompt()` or `agent.continue(conversationId).prompt()` for persistent memory.
- **Provider/model string**: Format is `'provider/model'` (e.g. `'anthropic/claude-sonnet-4-5'`, `'openai/gpt-4o'`).
- **Finish reasons**: `'stop'`, `'tool_calls'`, `'length'`, `'client_tool_calls'`, `'tool_approval_required'`.

## Step-by-step

### 1. Create an agent class

```ts
// app/Agents/ResearchAgent.ts
import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

export class ResearchAgent extends Agent implements HasTools {
  instructions(): string {
    return `You are a research assistant. Use the search tool to find
    information and summarize your findings clearly.`
  }

  model(): string {
    return 'anthropic/claude-sonnet-4-5'
  }

  tools(): AnyTool[] {
    return [searchTool, summarizeTool]
  }

  maxSteps(): number {
    return 10
  }
}
```

### 2. Run a prompt (non-streaming)

```ts
const agent = new ResearchAgent()

const response = await agent.prompt('What is Rudder?')
console.log(response.text)        // final text output
console.log(response.steps)       // array of AgentStep
console.log(response.usage)       // { promptTokens, completionTokens, totalTokens }
```

### 3. Stream a response

```ts
const { stream, response } = agent.stream('Explain TypeScript decorators')

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'text-delta':
      process.stdout.write(chunk.text ?? '')
      break
    case 'tool-call':
      console.log(`Calling tool: ${chunk.toolCall?.name}`)
      break
    case 'tool-result':
      console.log(`Tool result:`, chunk.result)
      break
    case 'tool-update':
      console.log(`Progress:`, chunk.update)
      break
    case 'finish':
      console.log(`Done: ${chunk.finishReason}`)
      break
  }
}

const finalResponse = await response
```

### 4. Use anonymous agents (inline)

```ts
import { agent } from '@rudderjs/ai'

// Simple string instructions
const response = await agent('You are a helpful assistant.').prompt('Hello')

// With tools and model
const response = await agent({
  instructions: 'You are a search assistant.',
  tools: [searchTool],
  model: 'anthropic/claude-sonnet-4-5',
}).prompt('Find users named John')
```

### 5. Conversation persistence

```ts
const myAgent = new ResearchAgent()

// Start a new conversation for a user
const response1 = await myAgent.forUser('user-123').prompt('What is TypeScript?')
const convId = response1.conversationId!

// Continue the same conversation
const response2 = await myAgent.continue(convId).prompt('Tell me more about generics')
// The agent sees the full conversation history

// Streaming with conversations
const { stream, response } = myAgent.forUser('user-123').stream('Explain async/await')
```

A `ConversationStore` must be registered. The built-in `MemoryConversationStore` works for dev; implement the `ConversationStore` interface for production (database-backed).

### 6. Stop conditions

```ts
import { Agent, stepCountIs, hasToolCall } from '@rudderjs/ai'

class MyAgent extends Agent {
  instructions() { return 'You are helpful.' }

  stopWhen() {
    return [
      stepCountIs(5),                    // stop after 5 iterations
      hasToolCall('final_answer'),       // stop when this tool is called
    ]
    // Multiple conditions use OR logic -- stops when any is true
  }
}
```

### 7. Per-step control (prepareStep)

```ts
class AdaptiveAgent extends Agent {
  instructions() { return 'You are helpful.' }

  prepareStep(ctx: { stepNumber: number; steps: AgentStep[]; messages: AiMessage[] }) {
    if (ctx.stepNumber > 3) {
      return { model: 'anthropic/claude-haiku-3' }  // cheaper model for later steps
    }
    return {}
  }
}
```

### 8. Middleware

```ts
import type { AiMiddleware } from '@rudderjs/ai'

const loggingMiddleware: AiMiddleware = {
  name: 'logging',
  onStart(ctx) { console.log(`Agent started, model: ${ctx.model}`) },
  onChunk(ctx, chunk) {
    if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '')
    return chunk  // return null to suppress the chunk
  },
  onBeforeToolCall(ctx, toolName, args) {
    console.log(`Calling ${toolName}`, args)
    // Return { type: 'skip', result: 'mocked' } to skip execution
    // Return { type: 'abort', reason: 'blocked' } to abort the loop
  },
  onAfterToolCall(ctx, toolName, args, result) {
    console.log(`${toolName} returned`, result)
  },
  onUsage(ctx, usage) {
    console.log(`Tokens: ${usage.totalTokens}`)
  },
  onError(ctx, error) {
    console.error('Agent error:', error)
  },
}

class MyAgent extends Agent implements HasMiddleware {
  instructions() { return 'You are helpful.' }
  middleware() { return [loggingMiddleware] }
}
```

### 9. Queue for background execution

```ts
const myAgent = new ResearchAgent()

// Queue for async processing (requires @rudderjs/queue)
myAgent.queue('Analyze this dataset').dispatch()
```

### 10. Failover providers

```ts
class ResilientAgent extends Agent {
  instructions() { return 'You are helpful.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  failover() { return ['openai/gpt-4o', 'google/gemini-2.0-flash'] }
}
```

### 11. Attachments (images/documents)

```ts
const response = await agent('Describe this image.').prompt('What do you see?', {
  attachments: [
    { type: 'image', data: base64String, mimeType: 'image/png' },
    { type: 'document', data: pdfBase64, mimeType: 'application/pdf', name: 'report.pdf' },
  ],
})
```

## Examples

See `playground/app/Agents/ResearchAgent.ts` for a working agent class.

## Common pitfalls

- **Provider SDK not installed**: Each provider's SDK is an optional peer dependency. Install only what you use: `@anthropic-ai/sdk`, `openai`, `@google/genai`.
- **No default model**: If `model()` returns `undefined`, the agent uses the registry default from `config/ai.ts`. Make sure one is configured.
- **ConversationStore missing**: `forUser()` / `continue()` throw if no `ConversationStore` is registered. Register one via `setConversationStore()` or through the AI service provider.
- **maxSteps exhaustion**: Default is 20 iterations. If the agent hits `maxSteps`, it stops with whatever text it has. Override `maxSteps()` for agents that need more iterations.
- **Streaming vs non-streaming tool updates**: `yield` from an `async function*` tool execute emits `tool-update` chunks during streaming. In non-streaming `prompt()`, yields are silently drained.
- **Client tools**: Tools without an `execute` function are client tools. The loop pauses with `finishReason: 'client_tool_calls'` and returns `pendingClientToolCalls` for browser-side execution.
