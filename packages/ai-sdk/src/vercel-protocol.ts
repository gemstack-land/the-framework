import type { StreamChunk } from './types.js'

/**
 * Convert a Rudder AI stream to Vercel AI SDK Data Stream Protocol format.
 *
 * Protocol prefixes:
 * - `0:` text delta (JSON string)
 * - `9:` tool call begin (JSON: toolCallId + toolName)
 * - `a:` tool call delta (JSON: toolCallId + argsTextDelta)
 * - `b:` tool call result (JSON: toolCallId + result)
 * - `e:` finish (JSON: finishReason + usage)
 * - `d:` done (JSON: finishReason)
 *
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol#data-stream-protocol
 */
export function toVercelDataStream(stream: AsyncIterable<StreamChunk>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          let line: string | undefined

          switch (chunk.type) {
            case 'text-delta':
              line = `0:${JSON.stringify(chunk.text)}\n`
              break

            case 'tool-call-delta':
              if (chunk.toolCall?.name) {
                line = `9:${JSON.stringify({ toolCallId: chunk.toolCall.id ?? '', toolName: chunk.toolCall.name })}\n`
              }
              if (chunk.text) {
                line = (line ?? '') + `a:${JSON.stringify({ toolCallId: chunk.toolCall?.id ?? '', argsTextDelta: chunk.text })}\n`
              }
              break

            case 'tool-call':
              // Tool call complete — result will be emitted separately if available
              break

            case 'usage':
              // Usage is emitted as part of the finish chunk
              break

            case 'finish': {
              const finishReason = chunk.finishReason === 'tool_calls' ? 'tool-calls' : chunk.finishReason
              line = `e:${JSON.stringify({
                finishReason,
                usage: chunk.usage ? {
                  promptTokens: chunk.usage.promptTokens,
                  completionTokens: chunk.usage.completionTokens,
                } : undefined,
              })}\n`
              line += `d:${JSON.stringify({ finishReason })}\n`
              break
            }
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
