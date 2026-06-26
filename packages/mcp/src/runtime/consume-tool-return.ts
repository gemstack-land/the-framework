import type { McpToolResult, McpToolReturn, McpToolProgress } from '../McpTool.js'

/** SDK request handler `extra` shape — minimal; we only use sendNotification. */
export type SdkRequestExtra = {
  sendNotification?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void> | void
}

/**
 * Type guard distinguishing the streaming variant of `McpToolReturn` (an async
 * generator) from a plain `Promise<McpToolResult>`. Plain Promises don't have
 * `Symbol.asyncIterator`, so the presence of both `.next` and the
 * `Symbol.asyncIterator` method narrows reliably.
 */
function isAsyncGen(v: McpToolReturn): v is AsyncGenerator<McpToolProgress, McpToolResult, unknown> {
  const maybe = v as { next?: unknown; [Symbol.asyncIterator]?: unknown }
  return typeof maybe.next === 'function'
    && typeof maybe[Symbol.asyncIterator] === 'function'
}

/**
 * Run a tool's `handle()` return value to completion.
 *
 * - Plain `Promise<McpToolResult>` → just await it.
 * - `AsyncGenerator<McpToolProgress, McpToolResult>` → iterate, forwarding each
 *   yield as a `notifications/progress` message to the client (only when the
 *   request supplied a `progressToken` in `_meta`), and resolve to the final
 *   value the generator returns.
 *
 * Errors propagate normally so the outer try/catch handles them.
 */
export async function consumeToolReturn(
  ret: McpToolReturn,
  extra: SdkRequestExtra | undefined,
  meta: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  if (!isAsyncGen(ret)) return await ret

  const progressToken = meta?.['progressToken']
  const sendNotification = extra?.sendNotification

  while (true) {
    const next = await ret.next()
    if (next.done) return next.value
    if (progressToken !== undefined && sendNotification) {
      await sendNotification({
        method: 'notifications/progress',
        params: { progressToken, ...next.value },
      })
    }
  }
}
