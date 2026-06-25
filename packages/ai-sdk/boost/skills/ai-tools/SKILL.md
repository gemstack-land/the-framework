---
name: ai-tools
description: Defining server and client tools with Zod schemas, approval gates, streaming yields, and modelOutput for Rudder AI agents
license: MIT
appliesTo:
  - '@rudderjs/ai'
trigger: writing a `toolDefinition()`, defining server or client tools, adding streaming yields, or wiring approval gates
skip: configuring an `Agent` class itself — load `ai-agents` instead
metadata:
  author: rudderjs
---

# AI Tools

## When to use this skill

Load this skill when you need to define tools for AI agents -- server-side executors, client-side browser tools, streaming generator tools, approval gates, or tools with custom model output formatting.

## Key concepts

- **toolDefinition()**: Builder function that creates a typed tool from a Zod input schema. Call `.server()` to attach a handler, or leave as-is for a client tool.
- **Server tools**: Have an `execute` function that runs on the server. Can be a regular async function or an `async function*` generator.
- **Client tools**: No `execute` -- the agent loop pauses and returns pending tool calls for browser-side execution.
- **Approval gates**: `needsApproval: true` (or a predicate function) pauses the loop with `tool_approval_required` finish reason.
- **modelOutput()**: Transform the tool's structured result into a shorter string for the model's context, while the UI still gets the full result.
- **Tool updates (streaming)**: Generator tools can `yield` progress payloads that surface as `tool-update` stream chunks.

## Step-by-step

### 1. Basic server tool

```ts
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
}).server(async ({ location, units }) => {
  const data = await fetchWeather(location, units)
  return { temp: data.temperature, conditions: data.conditions, unit: units }
})
```

### 2. Client tool (browser-side execution)

```ts
// No .server() call -- this is a client tool
const readClipboardTool = toolDefinition({
  name: 'read_clipboard',
  description: 'Read the contents of the user clipboard',
  inputSchema: z.object({}),
})

// When the agent calls this tool, the loop pauses with:
// finishReason: 'client_tool_calls'
// pendingClientToolCalls: [{ id, name: 'read_clipboard', arguments: {} }]
// The caller executes it browser-side and resumes with tool results.
```

### 3. Tool with approval gate

```ts
const deleteUserTool = toolDefinition({
  name: 'delete_user',
  description: 'Permanently delete a user account',
  inputSchema: z.object({ userId: z.string() }),
  needsApproval: true,  // always requires approval
}).server(async ({ userId }) => {
  await User.forceDelete(userId)
  return { deleted: true }
})

// Conditional approval
const sendEmailTool = toolDefinition({
  name: 'send_email',
  description: 'Send an email to a user',
  inputSchema: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  needsApproval: (input) => input.to.endsWith('@external.com'),
}).server(async (input) => {
  await sendEmail(input)
  return { sent: true }
})
```

When approval is required, the loop stops with:
- `finishReason: 'tool_approval_required'`
- `pendingApprovalToolCall: { toolCall, isClientTool: false }`

Resume by passing `approvedToolCallIds` or `rejectedToolCallIds` in the next prompt options.

### 4. Streaming tool with progress yields

```ts
const analyzeDataTool = toolDefinition({
  name: 'analyze_data',
  description: 'Analyze a dataset and return insights',
  inputSchema: z.object({ datasetId: z.string() }),
}).server(async function* ({ datasetId }) {
  const dataset = await loadDataset(datasetId)

  yield { progress: 25, message: 'Loading data...' }

  const cleaned = cleanData(dataset)
  yield { progress: 50, message: 'Cleaning data...' }

  const analysis = runAnalysis(cleaned)
  yield { progress: 75, message: 'Running analysis...' }

  const insights = summarize(analysis)
  yield { progress: 100, message: 'Complete' }

  return { insights, recordCount: dataset.length }
  // Each yield surfaces as a 'tool-update' StreamChunk
  // The return value is the final 'tool-result'
})
```

### 5. modelOutput() -- control what the model sees

```ts
const searchTool = toolDefinition({
  name: 'search_documents',
  description: 'Search the document database',
  inputSchema: z.object({ query: z.string() }),
}).server(async ({ query }) => {
  const results = await searchDb(query)
  return {
    results,              // full structured data for the UI
    totalCount: results.length,
    metadata: { /* ... */ },
  }
}).modelOutput((result) => {
  // The MODEL only sees this condensed string on its next step
  // The UI still receives the full structured result above
  return `Found ${result.totalCount} results: ${result.results.map(r => r.title).join(', ')}`
})
```

### 6. Dynamic tools (runtime-defined schemas)

```ts
import { dynamicTool } from '@rudderjs/ai'

// When the schema isn't known at compile time
const tool = dynamicTool({
  name: agentDef.slug,
  description: agentDef.description,
  inputSchema: z.object({}),
}).server(async () => {
  return await agentDef.run()
})
```

### 7. Tool with ToolCallContext

```ts
const myTool = toolDefinition({
  name: 'my_tool',
  description: 'A tool that needs its call ID',
  inputSchema: z.object({ data: z.string() }),
}).server(async (input, ctx) => {
  // ctx.toolCallId is the unique ID the model assigned to this call
  console.log(`Tool call ID: ${ctx?.toolCallId}`)
  return { processed: true }
})
```

### 8. Lazy tools (not advertised until needed)

```ts
const secretTool = toolDefinition({
  name: 'admin_panel',
  description: 'Access admin functions',
  inputSchema: z.object({ action: z.string() }),
  lazy: true,  // not included in the tool list sent to the model
}).server(async ({ action }) => {
  // Only callable if the model explicitly names it
  return { result: await adminAction(action) }
})
```

### 9. Pause the parent loop from inside a server tool

```ts
import { pauseForClientTools, pauseForApproval } from '@rudderjs/ai'

const runSubAgentTool = toolDefinition({
  name: 'run_sub_agent',
  description: 'Run a sub-agent that may need browser tools or approval',
  inputSchema: z.object({ task: z.string() }),
}).server(async function* ({ task }, ctx) {
  const subResponse = await runSubAgent(task)

  if (subResponse.pendingClientToolCalls?.length) {
    // Client-tool pause -- surface inner client tool calls to the browser
    yield pauseForClientTools(subResponse.pendingClientToolCalls, subResponse.resumeId)
    return undefined as never  // unreachable after pause
  }

  if (subResponse.pendingApprovalToolCall) {
    // Approval pause -- surface the gated tool call for the user to approve/reject
    const { toolCall, isClientTool } = subResponse.pendingApprovalToolCall
    yield pauseForApproval(toolCall, isClientTool, subResponse.resumeId)
    return undefined as never
  }

  return subResponse.text
})
```

`Agent.asTool({ suspendable })` does this automatically — yield manually only for hand-rolled sub-agent runners or non-agent tools that need a browser/approval round-trip.

### 10. Using tools with an agent

```ts
import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

class MyAgent extends Agent implements HasTools {
  instructions() { return 'You are a helpful assistant with access to tools.' }

  tools(): AnyTool[] {
    return [
      weatherTool,
      searchTool,
      analyzeDataTool,
      deleteUserTool,
    ]
  }
}

// Or with the anonymous agent
const response = await agent({
  instructions: 'You are helpful.',
  tools: [weatherTool, searchTool],
}).prompt('What is the weather in Paris?')
```

## Examples

Tools are typically defined in `app/Tools/` or co-located with the agent that uses them. See `packages/ai/src/tool.ts` for the full builder API.

## Common pitfalls

- **Zod schemas required**: Tool input schemas must be Zod objects. They are converted to JSON Schema for each provider automatically.
- **Generator vs async function**: Use `async function*` only when you need streaming progress yields. For simple tools, use a regular `async` function.
- **modelOutput is optional**: Only use `.modelOutput()` when the tool returns large structured data that would waste model context. The default behavior is `JSON.stringify` of the result.
- **Approval flow is two-step**: When a tool needs approval, the loop stops. You must resume with `approvedToolCallIds` or `rejectedToolCallIds` in the next `prompt()` call's options. For approval-gated tools inside a sub-agent wrapped via `asTool({ suspendable })`, resume goes through `Agent.resumeAsTool(subRunId, [], { runStore, agent, approvedToolCallIds })` — the snapshot's `pauseKind: 'approval'` discriminator routes the resume contract.
- **Client tool placeholder mode**: By default, client tools without `execute` get a placeholder result and the loop continues. Pass `toolCallStreamingMode: 'stop-on-client-tool'` to pause instead.
- **exactOptionalPropertyTypes**: If your tsconfig has this enabled, do not pass `undefined` for optional tool parameters -- omit the key entirely.
- **Tool name conventions**: Use `snake_case` for tool names (e.g. `get_weather`, `search_documents`). This matches what AI models expect.
