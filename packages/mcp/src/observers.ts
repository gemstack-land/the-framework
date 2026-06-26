/**
 * MCP observer registry — Telescope and other collectors subscribe here to
 * receive structured events when tools, resources, and prompts are invoked.
 *
 * Same architecture as `@gemstack/ai-sdk/observers`: a singleton stored on
 * `globalThis` so state survives Vite SSR module re-evaluation, and a
 * try/catch around dispatch so an observer error never breaks an MCP
 * server.
 */

export interface McpObserverEvent {
  kind:
    | 'tool.called' | 'tool.failed'
    | 'resource.read' | 'resource.failed'
    | 'prompt.rendered' | 'prompt.failed'
  serverName: string
  /** Tool name, resource URI, or prompt name */
  name:       string
  /** Tool args, resource URI params, or prompt args */
  input:      unknown
  /** Tool result, resource content, or prompt messages (null on failure) */
  output:     unknown
  /** Wall-clock duration in ms */
  duration:   number
  /** Present on `*.failed` events */
  error?:     string
}

export type McpObserver = (event: McpObserverEvent) => void

export class McpObserverRegistry {
  private observers: McpObserver[] = []

  subscribe(fn: McpObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter((o) => o !== fn) }
  }

  emit(event: McpObserverEvent): void {
    for (const observer of this.observers) {
      try { observer(event) } catch { /* observer errors must not break MCP servers */ }
    }
  }

  reset(): void { this.observers = [] }
}

const _g = globalThis as Record<string, unknown>
if (!_g['__gemstack_mcp_observers__']) {
  _g['__gemstack_mcp_observers__'] = new McpObserverRegistry()
}
export const mcpObservers = _g['__gemstack_mcp_observers__'] as McpObserverRegistry
