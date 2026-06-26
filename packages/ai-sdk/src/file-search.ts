/**
 * `fileSearch({ stores, where?, maxResults?, name?, description? })` — agent
 * tool factory for hosted vector-store retrieval (#B8 Phase 2).
 *
 * Wraps OpenAI's native `file_search` tool. The tool object is tagged with
 * `providerHint: { type: 'file-search', ... }`; the OpenAI adapter's
 * `toOpenAITools` recognizes the hint and emits the native
 * `{ type: 'file_search', vector_store_ids, filters, max_num_results }`
 * block instead of a generic function-call shape. The model runs the search
 * server-side and the results land in the assistant message — no agent-loop
 * tool round-trip on the hosted path.
 *
 * # Hosted on OpenAI today
 *
 * Other providers see the tool as a regular function-call tool with the
 * placeholder `{ query: string }` schema — without an `execute` they pause
 * for client tools, which is degraded. Phase 3 will add a `fallback` opt
 * that installs an `execute` delegating to `similaritySearch` over a local
 * pgvector model.
 *
 * # Wiring
 *
 * ```ts
 * import { Agent, fileSearch, VectorStores } from '@gemstack/ai-sdk'
 *
 * const kb = await VectorStores.get('vs_abc123')
 *
 * class SupportAgent extends Agent {
 *   model() { return 'openai/gpt-4o' }
 *   tools() {
 *     return [
 *       fileSearch({
 *         stores:     [kb.id],
 *         where:      { author: 'Alice', year: 2026 },
 *         maxResults: 10,
 *       }),
 *     ]
 *   }
 * }
 * ```
 *
 * # Metadata filter sugar
 *
 * `where: { author: 'Alice', year: 2026 }` is shorthand for the typed
 * OpenAI filter shape `{ type: 'and', filters: [{ type: 'eq', key: 'author',
 * value: 'Alice' }, { type: 'eq', key: 'year', value: 2026 }] }`. Either
 * shape works — pass the typed object form for `gt` / `lt` / `or`.
 */

import { z } from 'zod'

import { similaritySearch } from './similarity-search.js'
import type { SimilaritySearchOptions } from './similarity-search.js'
import type { ProviderHint, Tool, ToolDefinitionOptions, ToolDefinitionSchema, ToolExecuteFn } from './types.js'

/**
 * Symbol-tagged marker identifying a file-search tool. Mirrors the
 * `COMPUTER_USE_MARKER` pattern — `Symbol.for(...)` so cross-bundle /
 * cross-realm checks succeed even when `@gemstack/ai-sdk` loads twice.
 */
export const FILE_SEARCH_MARKER: unique symbol = Symbol.for('rudderjs.ai.file-search')

/**
 * Default tool name. OpenAI's native `file_search` tool expects calls to
 * land on a tool literally named `file_search` — the model is trained on
 * that identifier. Apps can override via `opts.name` but usually shouldn't.
 */
export const FILE_SEARCH_TOOL_NAME = 'file_search'

const DEFAULT_DESCRIPTION =
  'Search the configured knowledge base(s) for documents relevant to the query. ' +
  'Returns the most relevant passages alongside the source document metadata.'

/** OpenAI vector-store metadata filter, typed form. */
export type FileSearchFilter =
  | { type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; key: string; value: string | number | boolean }
  | { type: 'and' | 'or'; filters: FileSearchFilter[] }

/** Sugar shape for `where` — `{ key: value }` pairs lowered to a typed `and` of `eq` filters. */
export type FileSearchWhereSugar = Record<string, string | number | boolean>

/**
 * Local pgvector fallback configuration (#B8 Phase 3). When set, the tool
 * gains an `execute` that delegates to {@link similaritySearch} against
 * the supplied Model. Forwards every {@link SimilaritySearchOptions} field
 * except `name` / `description` (those flow from the outer `fileSearch`
 * call so the agent prompt stays identical across providers).
 */
export type FileSearchFallback<TInstance = unknown> =
  Omit<SimilaritySearchOptions<TInstance>, 'name' | 'description'>

export interface FileSearchOptions<TInstance = unknown> {
  /**
   * Vector-store IDs the model should search. At least one required.
   * Mixing providers (e.g. an OpenAI `vs_...` id with a Gemini cached-
   * content id) is not supported in v1 — every id must come from the
   * agent's configured provider.
   */
  stores: string[]
  /**
   * Metadata filter applied server-side. Accepts either the sugar
   * `{ key: value }` form (lowered to an `and` of `eq` filters) or the
   * typed {@link FileSearchFilter} shape directly.
   */
  where?: FileSearchWhereSugar | FileSearchFilter
  /** Maximum number of result chunks to return. Provider default applies when unset. */
  maxResults?: number
  /** Override the tool name. Defaults to {@link FILE_SEARCH_TOOL_NAME}. */
  name?: string
  /** Override the tool description shown to the model. Defaults to a generic phrasing. */
  description?: string
  /**
   * Local pgvector fallback (#B8 Phase 3). When set, the returned tool gains
   * an `execute` that delegates to `similaritySearch` for providers that
   * don't recognize the `'file-search'` `providerHint`.
   *
   * The cascade is automatic. On OpenAI the adapter emits the native
   * `file_search` block — the search runs server-side, the model never
   * invokes the function-call tool, and `execute` is dead weight. On any
   * other provider (Anthropic, Gemini today, others) the tool serializes
   * as a regular function-call schema, the model calls it, and `execute`
   * delegates to `similaritySearch` against the local pgvector model.
   *
   * Same agent prompt across hosted and self-hosted RAG — ops can swap
   * deployment targets without retraining.
   *
   * @example
   * ```ts
   * fileSearch({
   *   stores: [vs_id],
   *   fallback: {
   *     model:     Document,
   *     column:    'embedding',
   *     embedWith: 'openai/text-embedding-3-small',
   *   },
   * })
   * ```
   */
  fallback?: FileSearchFallback<TInstance>
}

/**
 * A `fileSearch` tool. Implements {@link Tool}; carries
 * {@link FILE_SEARCH_MARKER} for typeguarding.
 *
 * `execute` is absent on the hosted-only path (no `fallback` opt) — the
 * provider runs the search natively and the model gets results back
 * inline. With a `fallback` opt configured (#B8 Phase 3), `execute` is
 * present and delegates to `similaritySearch` so non-native providers
 * (Anthropic, Gemini today, others) get a working RAG path against a
 * local pgvector model.
 */
export interface FileSearchTool extends Tool<{ query: string }, unknown> {
  readonly [FILE_SEARCH_MARKER]: true
  readonly definition: ToolDefinitionOptions
  toSchema(): ToolDefinitionSchema
}

/** Build the agent tool. See module JSDoc for usage. */
export function fileSearch<TInstance = unknown>(opts: FileSearchOptions<TInstance>): FileSearchTool {
  if (!Array.isArray(opts.stores) || opts.stores.length === 0) {
    throw new Error(
      '[ai-sdk] fileSearch({ stores }) requires at least one vector-store id. ' +
      'Create a store via `VectorStores.create(...)` and pass its `id`.',
    )
  }

  const name        = opts.name        ?? FILE_SEARCH_TOOL_NAME
  const description = opts.description ?? DEFAULT_DESCRIPTION

  const filters = opts.where !== undefined ? normalizeWhere(opts.where) : undefined

  // The provider hint is the load-bearing piece — adapters recognizing
  // `type === 'file-search'` substitute their native tool block.
  const providerHint: ProviderHint = { type: 'file-search', vector_store_ids: opts.stores }
  if (filters)               providerHint['filters']         = filters
  if (opts.maxResults !== undefined) providerHint['max_num_results'] = opts.maxResults

  const definition: ToolDefinitionOptions = {
    name,
    description,
    // Placeholder schema. Non-OpenAI providers see this and treat the
    // tool as a normal function-call. OpenAI's native block drops it.
    inputSchema: z.object({ query: z.string().describe('Natural-language query.') }),
    providerHint,
  }

  // Build the fallback execute when configured. The inner similaritySearch
  // tool's name/description are overridden so structural identity stays on
  // the outer fileSearch (the model still sees the same tool and prompt).
  let execute:        ToolExecuteFn<{ query: string }, unknown, unknown> | undefined
  let toModelOutput:  ((result: unknown) => string | Promise<string>) | undefined
  if (opts.fallback) {
    const inner = similaritySearch<TInstance>({
      ...opts.fallback,
      name,
      description,
    })
    execute       = inner.execute       as ToolExecuteFn<{ query: string }, unknown, unknown>
    toModelOutput = inner.toModelOutput as ((result: unknown) => string | Promise<string>) | undefined
  }

  const tool: FileSearchTool = {
    [FILE_SEARCH_MARKER]: true,
    definition,
    ...(execute       ? { execute       } : {}),
    ...(toModelOutput ? { toModelOutput } : {}),
    toSchema(): ToolDefinitionSchema {
      const schema: ToolDefinitionSchema = {
        name,
        description,
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        providerHint,
      }
      return schema
    },
  }

  return tool
}

/**
 * Structural typeguard. Mirrors `isComputerUseTool` / `isHandoffTool` —
 * tools are plain objects tagged with `Symbol.for(...)` markers so the
 * loop and adapters can detect them without coupling to a class.
 */
export function isFileSearchTool(t: unknown): t is FileSearchTool {
  if (t === null || typeof t !== 'object') return false
  const marker = (t as Record<string | symbol, unknown>)[FILE_SEARCH_MARKER]
  return marker === true
}

/**
 * Lower the user-friendly `where` shape to OpenAI's typed filter object.
 *
 * - `{ author: 'Alice', year: 2026 }` → `{ type: 'and', filters: [eq, eq] }`
 * - `{ type: 'eq' | ... }`           → pass-through
 * - `{ type: 'and' | 'or', filters }` → pass-through
 *
 * A single-key sugar object short-circuits to the bare `eq` (no `and`
 * wrapper), matching OpenAI's recommended shape.
 */
export function normalizeWhere(where: FileSearchWhereSugar | FileSearchFilter): FileSearchFilter {
  if (isTypedFilter(where)) return where

  const entries = Object.entries(where)
  if (entries.length === 0) {
    throw new Error('[ai-sdk] fileSearch({ where }) must contain at least one key.')
  }
  const eqs: FileSearchFilter[] = entries.map(([key, value]) => ({ type: 'eq', key, value }))
  return eqs.length === 1 ? eqs[0]! : { type: 'and', filters: eqs }
}

function isTypedFilter(w: FileSearchWhereSugar | FileSearchFilter): w is FileSearchFilter {
  if (typeof w !== 'object' || w === null) return false
  const t = (w as { type?: unknown }).type
  return typeof t === 'string'
    && (t === 'eq' || t === 'ne' || t === 'gt' || t === 'gte' || t === 'lt' || t === 'lte' || t === 'and' || t === 'or')
}
