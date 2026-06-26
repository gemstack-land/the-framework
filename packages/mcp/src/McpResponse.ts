import type { McpToolResult } from './McpTool.js'

/**
 * Helpers for building a tool's {@link McpToolResult}. Return one of these from
 * a tool's `handle()`.
 */
export class McpResponse {
  /** A plain-text result. */
  static text(content: string): McpToolResult {
    return { content: [{ type: 'text', text: content }] }
  }

  /** A structured result, serialized as pretty-printed JSON text. */
  static json(data: unknown): McpToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }

  /**
   * An error result (`isError: true`), prefixed with `Error: `. The client sees
   * a failed tool call rather than a thrown exception, so prefer this for
   * expected, user-facing failures (validation, not-found) and reserve throwing
   * for unexpected faults.
   */
  static error(message: string): McpToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
}
