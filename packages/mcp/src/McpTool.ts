import { toKebabCase } from './utils.js'
import { getDescription } from './decorators.js'
import type { ZodLikeObject } from './types.js'

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

/**
 * Progress update yielded by a streaming tool. Forwarded as a
 * `notifications/progress` message when the calling client supplied a
 * `progressToken` in the request `_meta`. Streaming tools that run without a
 * progressToken still execute; the runtime drops the yields silently.
 */
export interface McpToolProgress {
  /** Current progress value — typically 0..total or unbounded. */
  progress: number
  /** Optional total — if set, clients can render a progress bar. */
  total?: number
  /** Optional human-readable status message. */
  message?: string
}

/** Return shape for a tool's `handle()` — a plain Promise *or* an async generator that yields progress updates. */
export type McpToolReturn =
  | Promise<McpToolResult>
  | AsyncGenerator<McpToolProgress, McpToolResult, unknown>

export abstract class McpTool {
  /** Tool name — derived from class name if not overridden. ClassName -> kebab-case minus "Tool" suffix */
  name(): string {
    return toKebabCase(this.constructor.name.replace(/Tool$/, ''))
  }

  /** Tool description — override or use @Description decorator */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Input schema — a Zod object (v3 or v4). */
  abstract schema(): ZodLikeObject

  /** Optional output schema — advertises the structure of the tool's response. */
  outputSchema?(): ZodLikeObject

  /**
   * Handle the tool call.
   *
   * Two shapes are accepted:
   * 1. `async handle(input)` returning the final result.
   * 2. `async *handle(input)` yielding `McpToolProgress` updates and returning
   *    the final result. Yields are forwarded to the client as
   *    `notifications/progress` messages when the caller supplied a
   *    `progressToken`. Mirror of @gemstack/ai-sdk's streaming-tool pattern —
   *    don't take a "send" callback parameter.
   *
   * Extra parameters beyond `input` are resolved from the DI container when
   * the method is decorated with `@Handle(Token1, …)`. Example:
   *
   * ```ts
   * @Handle(Logger)
   * async handle(input, logger: Logger) { ... }
   * ```
   */
  abstract handle(input: Record<string, unknown>, ...deps: unknown[]): McpToolReturn

  /**
   * Optional hook controlling whether this tool is exposed to clients.
   *
   * Returning `false` hides the tool from `tools/list` AND causes `tools/call`
   * to return an "unknown tool" error — preventing bypass via direct call.
   *
   * Use for static gating (env flags, feature toggles, build mode). The hook
   * runs with no arguments today; per-request gating (auth-scoped tools) is
   * tracked as future work.
   */
  shouldRegister?(): boolean | Promise<boolean>
}
