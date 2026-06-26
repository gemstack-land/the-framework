import type { McpToolResult } from './McpTool.js'

export class McpResponse {
  static text(content: string): McpToolResult {
    return { content: [{ type: 'text', text: content }] }
  }

  static json(data: unknown): McpToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }

  static error(message: string): McpToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
}
