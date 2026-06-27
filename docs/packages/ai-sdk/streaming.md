# Streaming

`agent.stream(...)` runs the same agent loop as [`prompt()`](/packages/ai-sdk/agents) but hands you the tokens as they arrive. It returns an `AgentStreamResponse`: a chunk iterator plus a promise that resolves to the full `AgentResponse` once the loop finishes.

```ts
import { agent } from '@gemstack/ai-sdk'

const { stream, response } = agent('You are a helpful assistant.').stream('Tell me a story.')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta')  process.stdout.write(chunk.text ?? '')
  if (chunk.type === 'tool-call')   console.log('Tool called:', chunk.toolCall)
  if (chunk.type === 'tool-update') console.log('Progress:',    chunk.update)
  if (chunk.type === 'tool-result') console.log('Result:',      chunk.result)
}

const final = await response   // resolves after the stream has been consumed
```

## Chunk shape

Every value yielded by the stream is a `StreamChunk` discriminated by `chunk.type`:

| `type` | Carries | Meaning |
|---|---|---|
| `text-delta` | `text` | A slice of assistant text. |
| `tool-call-delta` | `toolCall` (partial), `text`, `toolCallIndex` | Streamed tool-call arguments, before the call is whole. |
| `tool-call` | `toolCall` | A complete tool call the agent decided to make. |
| `tool-update` | `toolCall`, `update` | Per-`yield` progress from a streaming tool (`async function*` handler). Ephemeral: not persisted, not seen by the model on the next step. |
| `tool-result` | `toolCall`, `result` | The value a server-side tool handler returned. |
| `pending-client-tools` | `toolCalls` | Tool calls with no server handler, awaiting a browser round-trip. |
| `pending-approval` | `toolCall`, `isClientTool` | A tool call paused on an approval gate. |
| `handoff` | `handoff` (`{ from, to, message? }`) | Control transferred to another agent. |
| `usage` | `usage` | Token usage. |
| `finish` | `finishReason`, `usage` | The loop ended. |

`chunk.toolCall` is a `Partial<ToolCall>` (`{ id?, name?, arguments? }`), so guard the fields you read.

## Vercel AI SDK protocol

For interop with the Vercel AI SDK data-stream wire (the numeric-prefix protocol that `useChat()` reads), convert the chunk iterator:

```ts
import { agent, toVercelResponse } from '@gemstack/ai-sdk'

// In a Fetch-style route handler:
const { stream } = agent('You are a helpful assistant.').stream(message)
return toVercelResponse(stream)   // text/plain Response, X-Vercel-AI-Data-Stream: v1
```

`toVercelResponse(stream)` wraps a `Response`; `toVercelDataStream(stream)` returns the raw `ReadableStream<Uint8Array>` if you need to frame the response yourself. Both take the `stream` iterator (`AgentStreamResponse.stream`), not the whole `{ stream, response }` object.

## Server-Sent Events (named-event protocol)

When you want a plain `text/event-stream` with self-describing event names (rather than the Vercel numeric-prefix wire), `@gemstack/ai-sdk` ships a matched server/browser pair so the wire vocabulary can never drift between the two ends. Both live in the engine and use only web globals (`ReadableStream`, `Response`, `TextEncoder`), so they run server-side (Node or edge) and in the browser alike.

### Server

`toAgentSseResponse(streaming, init?)` projects an `agent.stream()` result onto named events and frames it as a `text/event-stream` `Response`, with the standard no-cache and no-buffering headers set. Because it returns a web `Response`, return it directly from any Fetch-based handler (edge functions, Bun, Deno, Hono, or a Node runtime with a Fetch adapter):

```ts
import { agent, toAgentSseResponse } from '@gemstack/ai-sdk'

export async function handler(req: Request): Promise<Response> {
  const { message } = await req.json()
  const streaming = agent('You are a helpful assistant.').stream(message)
  return toAgentSseResponse(streaming)   // text/event-stream Response
}
```

If you need the raw bytes (for example to pipe into a Node `ServerResponse`), use `toAgentSseStream(streaming)`, which returns a `ReadableStream<Uint8Array>`.

It emits one named event per loop chunk: `text`, `tool_call`, `tool_update`, `tool_result`, `pending_client_tools`, `tool_approval_required`, `handoff`, then a terminal `complete` event carrying `{ done, finishReason, awaiting, steps, usage }` (or an `error` event if the run throws). `awaiting` is `'client_tools'` or `'approval'` when the loop paused.

### Browser

`readAgentStream(response, callbacks?)` decodes those events back into an accumulated `AgentStreamTurn` and fires per-event callbacks:

```ts
import { readAgentStream } from '@gemstack/ai-sdk'

const resp = await fetch('/chat', { method: 'POST', body: JSON.stringify({ message }) })
if (!resp.ok) throw new Error(await resp.text())   // caller owns the error branch

const turn = await readAgentStream(resp, {
  onText: (t) => appendToBubble(t),
  onToolCall: (c) => showToolChip(c.tool),
})

if (turn.awaiting === 'client_tools') runClientTools(turn.pendingClientTools)
```

Pass an already-OK response: `readAgentStream` does not check `resp.ok`, so you own the non-2xx branch (where a rich error body can be read). The resolved `AgentStreamTurn` accumulates `assistantText`, `assistantToolCalls`, `serverToolResults`, `pendingClientTools`, `pendingApproval`, `handoffPath`, `done`, and `awaiting`. Available callbacks are `onText`, `onToolCall`, `onToolUpdate`, `onToolResult`, `onPendingClientTools`, `onToolApprovalRequired`, `onHandoff`, `onComplete`, `onError`, plus `onAppEvent` for any event outside the protocol vocabulary (conversation ids, billing, sub-run fan-out: emit and decode those on your own channel alongside this protocol).

The reducer is exposed as `applyAgentSseEvent(event, data, turn, callbacks?)` (with `newAgentStreamTurn()` for a fresh turn) so you can unit-test event handling without a live stream.

## React client (`useAgentRun`)

`@gemstack/ai-sdk/react` wraps `readAgentStream` in a hook so a component does not hand-roll the same state machine: it drives the stream, accumulates a transcript, tracks status, and surfaces pending client-tool calls and approval gates. React lives behind the subpath (peer `react@>=19.2.0`); the main `@gemstack/ai-sdk` entry stays runtime-agnostic.

```tsx
import { useAgentRun } from '@gemstack/ai-sdk/react'

function Chat() {
  const { status, outputs, run, pendingApproval, approve, reject } = useAgentRun({
    // The app owns the endpoint + body shape: only your route can rebuild the
    // server-side message history from a resume intent.
    request: (req, signal) =>
      fetch('/api/agent', { method: 'POST', body: JSON.stringify(req), signal }),
    // Optional: auto-execute client tools in the browser and resume.
    clientTools: (call) => runLocalTool(call.name, call.arguments),
  })

  return (
    <>
      {outputs.map((o, i) => <Entry key={i} output={o} />)}
      {pendingApproval && (
        <Confirm
          onYes={() => approve(pendingApproval.toolCall.id)}
          onNo={() => reject(pendingApproval.toolCall.id)}
        />
      )}
      <button disabled={status === 'running'} onClick={() => run('Summarize the latest report')}>
        Ask
      </button>
    </>
  )
}
```

The hook returns `status` (`'idle'` / `'running'` / `'complete'` / `'error'`), the `outputs` transcript (text, tool calls/results, approval requests, handoffs), `pendingClientTools`, `pendingApproval`, and `error`, plus imperative `run` / `respond` / `approve` / `reject` / `reset`. While paused awaiting client tools (no resolver) or an approval decision, `status` stays `'running'` and the matching `pending*` field is populated until you resume. With a `clientTools` resolver, client-tool pauses auto-resume; approval gates always wait for an explicit `approve` / `reject`.

The state machine and stream driver are exported framework-free (also from `@gemstack/ai-sdk/react`) for non-React use or tests: `driveAgentRun(req, opts)`, `executeClientTools(calls, resolver)`, and the `appendAgentOutput(outputs, event, data)` transcript reducer.

## Cancellation

Pass an `AbortSignal` to cancel an in-flight run. The signal is honored at iteration boundaries and forwarded to the provider adapter so the underlying network request is also cancelled. When the signal aborts, `prompt()` rejects (and `stream()`'s `response` promise rejects) with the signal's reason:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 5_000)

try {
  await agent('...').prompt('long task', { signal: controller.signal })
} catch (err) {
  // DOMException: This operation was aborted (or TimeoutError for AbortSignal.timeout())
}

// Or the standard timeout helper:
await agent('...').prompt('...', { signal: AbortSignal.timeout(10_000) })
```

The same `signal` option works on `stream(...)`: aborting rejects the `response` promise and ends the chunk iterator. In React, `useAgentRun` wires an `AbortController` for you, so `reset()` (or starting a new `run`) aborts any in-flight stream.

## See also

- [Agents](/packages/ai-sdk/agents) for `prompt()`, tools, and multi-step loops.
- [Structured Output](/packages/ai-sdk/structured-output) for typed results and multi-modal input.
- [Testing](/packages/ai-sdk/testing) for driving streams against the fake.
