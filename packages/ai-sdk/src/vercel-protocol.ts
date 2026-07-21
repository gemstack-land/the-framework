import type { StreamChunk } from './types.js'

/**
 * Convert an ai-sdk agent stream to Vercel AI SDK Data Stream Protocol format
 * (the v4 wire that `X-Vercel-AI-Data-Stream: v1` selects and `useChat()` reads).
 *
 * Protocol prefixes:
 * - `0:` text delta (JSON string)
 * - `9:` tool call, complete (JSON: toolCallId + toolName + args)
 * - `a:` tool result (JSON: toolCallId + result)
 * - `b:` tool call streaming start (JSON: toolCallId + toolName)
 * - `c:` tool call delta (JSON: toolCallId + argsTextDelta)
 * - `e:` finish step (JSON: finishReason + usage)
 * - `d:` finish message (JSON: finishReason + usage)
 *
 * @see https://ai-sdk.dev/v4/docs/ai-sdk-ui/stream-protocol
 */
export function toVercelDataStream(stream: AsyncIterable<StreamChunk>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      // Arg-delta chunks carry no tool call id on adapters that ship args as a
      // bare text delta (Anthropic, Bedrock), but `c:` parts must be addressed.
      // Same index-then-most-recent routing the agent loop uses. See #999.
      const startedByIndex = new Map<number, string>()
      let lastStartedId = ''

      try {
        for await (const chunk of stream) {
          let line: string | undefined

          switch (chunk.type) {
            case 'text-delta':
              line = `0:${JSON.stringify(chunk.text)}\n`
              break

            case 'tool-call-delta': {
              if (chunk.toolCall?.id) {
                lastStartedId = chunk.toolCall.id
                if (typeof chunk.toolCallIndex === 'number') {
                  startedByIndex.set(chunk.toolCallIndex, chunk.toolCall.id)
                }
              }
              if (chunk.toolCall?.name) {
                line = `b:${JSON.stringify({ toolCallId: chunk.toolCall.id ?? '', toolName: chunk.toolCall.name })}\n`
              }
              if (chunk.text) {
                const toolCallId = chunk.toolCall?.id
                  ?? (typeof chunk.toolCallIndex === 'number' ? startedByIndex.get(chunk.toolCallIndex) : undefined)
                  ?? lastStartedId
                line = (line ?? '') + `c:${JSON.stringify({ toolCallId, argsTextDelta: chunk.text })}\n`
              }
              break
            }

            case 'tool-call':
              if (chunk.toolCall) {
                line = `9:${JSON.stringify({
                  toolCallId: chunk.toolCall.id ?? '',
                  toolName: chunk.toolCall.name ?? '',
                  args: chunk.toolCall.arguments ?? {},
                })}\n`
              }
              break

            case 'tool-result':
              line = `a:${JSON.stringify({
                toolCallId: chunk.toolCall?.id ?? '',
                // `undefined` would drop the key and read back as an unresolved
                // result on the client, so null-fill it.
                result: chunk.result === undefined ? null : chunk.result,
              })}\n`
              break

            case 'usage':
              // Usage is emitted as part of the finish chunk
              break

            case 'finish': {
              const finishReason = chunk.finishReason === 'tool_calls' ? 'tool-calls' : chunk.finishReason
              const usage = chunk.usage ? {
                promptTokens: chunk.usage.promptTokens,
                completionTokens: chunk.usage.completionTokens,
              } : undefined
              line = `e:${JSON.stringify({ finishReason, usage })}\n`
              line += `d:${JSON.stringify({ finishReason, usage })}\n`
              break
            }

            default:
              // 'tool-update' | 'pending-client-tools' | 'pending-approval' |
              // 'handoff' have no v4 data-stream part. Use the SSE protocol
              // (toAgentSseResponse) when a UI needs them.
              break
          }

          if (line) {
            controller.enqueue(encoder.encode(line))
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })
}

/** Create a Response object with proper headers for Vercel AI SDK streaming. */
export function toVercelResponse(stream: AsyncIterable<StreamChunk>): Response {
  return new Response(toVercelDataStream(stream), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  })
}
