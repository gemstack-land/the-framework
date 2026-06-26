import type { McpObserverRegistry } from '../observers.js'

// Lazy accessor — avoids importing the registry eagerly so the global
// singleton is always the one on `globalThis`, even across SSR re-eval.
let _mcpObs: McpObserverRegistry | null | undefined

export function getMcpObservers(): McpObserverRegistry | null {
  if (_mcpObs === undefined) {
    _mcpObs = (globalThis as Record<string, unknown>)['__gemstack_mcp_observers__'] as McpObserverRegistry | undefined ?? null
  }
  return _mcpObs
}
