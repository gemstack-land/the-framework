import type { Connector, ConnectorDefinition } from './types.js'

/** Connector ids and tool names share this charset so namespaced names stay MCP-safe. */
const ID_RE = /^[a-z][a-z0-9-]*$/

/**
 * Define a tool connector to an external service. Validates the shape and fills
 * defaults, returning a {@link Connector} ready to pass to `mountConnectors`.
 *
 * ```ts
 * export default defineConnector({
 *   id: 'github',
 *   auth: { type: 'oauth', scopes: ['repo'] },
 *   tools: [{ name: 'list-issues', schema: ..., handle: async (input, ctx) => ... }],
 * })
 * ```
 */
export function defineConnector(def: ConnectorDefinition): Connector {
  if (!def || typeof def !== 'object') {
    throw new TypeError('defineConnector: expected a connector definition object')
  }
  if (!ID_RE.test(def.id ?? '')) {
    throw new Error(
      `defineConnector: invalid id ${JSON.stringify(def.id)} — use lowercase letters, digits, and "-" (must start with a letter)`,
    )
  }
  if (!Array.isArray(def.tools) || def.tools.length === 0) {
    throw new Error(`defineConnector("${def.id}"): at least one tool is required`)
  }

  const seen = new Set<string>()
  for (const tool of def.tools) {
    if (!ID_RE.test(tool?.name ?? '')) {
      throw new Error(
        `defineConnector("${def.id}"): invalid tool name ${JSON.stringify(tool?.name)} — use lowercase letters, digits, and "-"`,
      )
    }
    if (seen.has(tool.name)) {
      throw new Error(`defineConnector("${def.id}"): duplicate tool name "${tool.name}"`)
    }
    seen.add(tool.name)
    if (typeof tool.handle !== 'function') {
      throw new Error(`defineConnector("${def.id}"): tool "${tool.name}" is missing a handle() function`)
    }
    if (typeof tool.schema !== 'object' || tool.schema == null) {
      throw new Error(`defineConnector("${def.id}"): tool "${tool.name}" is missing a Zod schema`)
    }
  }

  return {
    id: def.id,
    name: def.name ?? def.id,
    version: def.version ?? '1.0.0',
    ...(def.instructions != null ? { instructions: def.instructions } : {}),
    auth: def.auth ?? { type: 'none' },
    tools: def.tools,
  }
}
