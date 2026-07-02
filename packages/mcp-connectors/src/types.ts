import type { McpToolResult, ZodLikeObject } from '@gemstack/mcp'

/**
 * What credential a connector needs to reach its external service. The
 * orchestrator reads this to know how to satisfy the connector, then hands a
 * resolved {@link Credential} to each tool call. The connector only *declares*
 * its requirement here; it never reaches for env vars or OAuth itself.
 */
export type ConnectorAuth =
  /** No credential needed (public data, local source). */
  | { type: 'none' }
  /** A personal access token / API key. `env` names a default env var to read. */
  | { type: 'pat'; description?: string; env?: string }
  /** OAuth 2.1 bearer token. Mirrors the @gemstack/mcp OAuth protect options. */
  | { type: 'oauth'; scopes?: string[]; authorizationServers?: string[]; description?: string }

/**
 * A credential resolved for one connector and handed to its tools at call time.
 * `token` is the common case (PAT or bearer); extra fields carry anything else
 * a connector's credential provider wants to thread through.
 */
export interface Credential {
  // `| undefined` is explicit so a provider can return `{ token: process.env.X }`
  // directly under exactOptionalPropertyTypes (env reads are string | undefined).
  token?: string | undefined
  [key: string]: unknown
}

/** Context passed to every connector tool handler. */
export interface ConnectorContext {
  /** The id of the connector this tool belongs to. */
  connectorId: string
  /** The credential resolved for this connector (`{}` when none was provided). */
  auth: Credential
}

/**
 * What a tool handler may return:
 * - a full {@link McpToolResult} (use `McpResponse` from @gemstack/mcp), or
 * - a `string` (wrapped as a text result), or
 * - any JSON-serializable value (wrapped as pretty-printed JSON text).
 */
export type ConnectorToolReturn = McpToolResult | string | unknown

/**
 * Behavioural hints advertised to MCP clients. They mirror the MCP tool
 * annotations and let agents reason about a tool before calling it — e.g. only
 * auto-approve `readOnly` tools. Default (all unset) means a read-write,
 * non-destructive, non-idempotent tool.
 */
export interface ConnectorToolAnnotations {
  /** The tool does not modify any state. */
  readOnly?: boolean
  /** The tool may perform destructive updates (deletes, overwrites). */
  destructive?: boolean
  /** Calling repeatedly with the same input has no additional effect. */
  idempotent?: boolean
  /** The tool interacts with the open world (external network / services). */
  openWorld?: boolean
}

/** A single tool a connector exposes. */
export interface ConnectorTool<Input = Record<string, unknown>> {
  /** Tool name, unique within the connector. Kept verbatim (namespaced at mount). */
  name: string
  /** One-line description shown to the agent. */
  description?: string
  /** Input schema — a Zod object (v3 or v4). */
  schema: ZodLikeObject
  /** Optional output schema advertised to clients. */
  outputSchema?: ZodLikeObject
  /** Optional behavioural hints. */
  annotations?: ConnectorToolAnnotations
  /** Run the tool. Receives validated input and the connector {@link ConnectorContext}. */
  handle: (input: Input, ctx: ConnectorContext) => ConnectorToolReturn | Promise<ConnectorToolReturn>
}

/** The object passed to {@link defineConnector}. */
export interface ConnectorDefinition {
  /** Stable, unique id (lowercase letters, digits, `-`). Used to namespace tools. */
  id: string
  /** Human-readable name. Defaults to `id`. */
  name?: string
  /** Connector version. Defaults to `1.0.0`. */
  version?: string
  /** Optional instructions surfaced to the agent at the server level. */
  instructions?: string
  /** Credential requirement. Defaults to `{ type: 'none' }`. */
  auth?: ConnectorAuth
  /**
   * The tools this connector exposes (at least one). Typed loosely so each tool
   * may annotate its own `handle` input (e.g. `(input: { id: string }) => ...`);
   * the Zod `schema` is the runtime source of truth.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ConnectorTool<any>[]
}

/** A validated connector, as returned by {@link defineConnector}. */
export interface Connector {
  id: string
  name: string
  version: string
  instructions?: string
  auth: ConnectorAuth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ConnectorTool<any>[]
}
