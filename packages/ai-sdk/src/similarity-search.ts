/**
 * `similaritySearch({ model, column, embedWith, ... })` — agent-tool
 * factory that wraps an `@rudderjs/orm` Model + a vector column into a
 * drop-in `Tool` an agent can call to retrieve semantically similar
 * rows (#B7 Phase 2).
 *
 * Composes B7 Phase 1's ORM primitives (`whereVectorSimilarTo` +
 * `selectVectorDistance`) with `AI.embed()`. The model emits a
 * natural-language `query`; the tool embeds it, runs a vector search,
 * and returns the top-K rows ranked by similarity.
 *
 * @example
 * ```ts
 * import { similaritySearch } from '@gemstack/ai-sdk'
 * import { Document } from './app/Models/Document.js'
 *
 * class KnowledgeAgent extends Agent {
 *   tools() {
 *     return [
 *       similaritySearch({
 *         model:         Document,
 *         column:        'embedding',
 *         embedWith:     'openai/text-embedding-3-small',
 *         minSimilarity: 0.7,
 *         limit:         10,
 *       }),
 *     ]
 *   }
 * }
 * ```
 *
 * Phase 2 limitations (lifted in Phase 2.5):
 * - **Standalone queries only.** No `scope`/`.where()` chaining yet —
 *   the underlying `whereVectorSimilarTo` query must run alone. Agents
 *   see every row in the corpus that matches the vector. Phase 2.5
 *   adds a `scope: (q) => q.where(...)` callback.
 * - **Cosine-centric similarity.** `similarity` is reported as
 *   `1 - distance` regardless of `metric`. For non-cosine metrics
 *   (`l2`, `inner-product`) the value is internally consistent with
 *   the `minSimilarity` filter applied by the adapter but isn't a
 *   meaningful normalized score on its own.
 */

import { z } from 'zod'
import { toolDefinition } from './tool.js'
import { AI } from './facade.js'
import type { ServerToolBuilder } from './tool.js'

/**
 * Structural type for the model class similaritySearch accepts.
 *
 * Declared locally instead of importing `Model` from `@rudderjs/orm`
 * so the main entry stays free of orm runtime — the tool calls
 * `model.query()` and never references the `@rudderjs/orm` package
 * itself. The user's app brings its own Model class.
 */
export interface SimilaritySearchModel<TInstance> {
  readonly name: string
  query(): SimilaritySearchQueryBuilder<TInstance>
}

/**
 * WhereOperator strings the `scope` callback may pass to `.where()`.
 * Mirrors `@rudderjs/contracts`'s `WhereOperator`. Duplicated here so the
 * main entry has no compile-time `@rudderjs/contracts` dep.
 */
export type SimilaritySearchWhereOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'LIKE' | 'NOT LIKE'
  | 'IN' | 'NOT IN'

/**
 * Structural type for the QueryBuilder methods similaritySearch needs.
 * Mirrors a subset of `@rudderjs/contracts`'s `QueryBuilder<T>` so apps
 * writing a `scope` callback get autocomplete on the methods that actually
 * compose with `whereVectorSimilarTo` (#B7 Phase 2.5):
 *
 * - `.where()` / `.orWhere()` chains compose into the SQL with positional
 *   parameter binding.
 * - `.with()` / `.orderBy()` / `.whereGroup()` / `.whereHas()` still throw
 *   when paired with a vector clause — out of scope for `scope`.
 */
export interface SimilaritySearchQueryBuilder<TInstance> {
  where(column: string, value: unknown): SimilaritySearchQueryBuilder<TInstance>
  where(column: string, operator: SimilaritySearchWhereOperator, value: unknown): SimilaritySearchQueryBuilder<TInstance>
  orWhere(column: string, value: unknown): SimilaritySearchQueryBuilder<TInstance>
  orWhere(column: string, operator: SimilaritySearchWhereOperator, value: unknown): SimilaritySearchQueryBuilder<TInstance>
  withTrashed?(): SimilaritySearchQueryBuilder<TInstance>
  onlyTrashed?(): SimilaritySearchQueryBuilder<TInstance>
  whereVectorSimilarTo?(
    column: string,
    query:  number[] | string,
    opts?:  { metric?: 'cosine' | 'l2' | 'inner-product'; minSimilarity?: number; embedWith?: string },
  ): SimilaritySearchQueryBuilder<TInstance>
  selectVectorDistance?(column: string, query: number[], alias: string): SimilaritySearchQueryBuilder<TInstance>
  limit(n: number): SimilaritySearchQueryBuilder<TInstance>
  get(): Promise<TInstance[]>
}

export interface SimilarityHit<TInstance> {
  readonly row: TInstance
  /**
   * Higher = closer. For `metric: 'cosine'` (default) this is
   * `1 - distance` ∈ [-1, 1]. For other metrics see the JSDoc on
   * {@link similaritySearch}.
   */
  readonly similarity: number
}

export interface SimilaritySearchOptions<TInstance> {
  /** The Model class whose rows will be searched. */
  model: SimilaritySearchModel<TInstance>

  /** The column on `model` declared with the `vector({ dimensions })` cast. */
  column: string

  /**
   * Embedding model id (`<provider>/<model>`). Required — fails loud
   * at factory construction time if missing so apps don't accidentally
   * route to whatever `AiRegistry.getDefault()` happens to be.
   */
  embedWith: string

  /** Default `'cosine'`. */
  metric?: 'cosine' | 'l2' | 'inner-product'

  /**
   * Drops rows whose `1 - distance` falls below this threshold. Cosine
   * range is `[-1, 1]` so values near `0.7–0.9` are typical for
   * "relevant" documents.
   */
  minSimilarity?: number

  /** Default `10`. */
  limit?: number

  /**
   * Pre-filter the query before the vector clause attaches. Receives a
   * fresh `model.query()` builder; return the chained builder. Use for
   * tenancy (`.where('tenantId', userId)`), publication state
   * (`.where('published', true)`), or any flat predicate that should
   * narrow the search corpus.
   *
   * **Phase 2.5 limits:** flat `.where()` / `.orWhere()` chains compose
   * into the SQL. `whereGroup` / `whereHas` / `with()` still throw at
   * terminal time — keep the scope flat.
   *
   * @example
   * ```ts
   * similaritySearch({
   *   model:     KnowledgeArticle,
   *   column:    'embedding',
   *   embedWith: 'openai/text-embedding-3-small',
   *   scope:     q => q.where('tenantId', currentTenant).where('published', true),
   * })
   * ```
   */
  scope?: (q: SimilaritySearchQueryBuilder<TInstance>) => SimilaritySearchQueryBuilder<TInstance>

  /**
   * Override the tool name. Default
   * `similarity_search_<model_name_lowercase>`.
   */
  name?: string

  /** Override the tool description. */
  description?: string

  /**
   * Custom string projection for each hit, replaces the default
   * `(0.87) {"id":1,"content":"..."}` shape that the model sees on its
   * next step. The structured array still flows to the UI via the
   * `tool-result` chunk.
   */
  projectResult?: (row: TInstance, similarity: number) => string
}

/** Internal alias used to read distance back off each row. */
const SIMILARITY_DISTANCE_ALIAS = '__rudderjs_similarity_distance__'

/**
 * Build a `Tool` that embeds a natural-language query and returns the
 * top-K similar rows from `model.column`.
 */
export function similaritySearch<TInstance>(
  opts: SimilaritySearchOptions<TInstance>,
): ServerToolBuilder<{ query: string }, SimilarityHit<TInstance>[]> {
  const {
    model,
    column,
    embedWith,
    metric = 'cosine',
    minSimilarity,
    limit = 10,
    name,
    description,
    projectResult,
    scope,
  } = opts

  if (!embedWith || typeof embedWith !== 'string') {
    throw new Error(
      '[ai-sdk] similaritySearch requires opts.embedWith (e.g. "openai/text-embedding-3-small"). ' +
      'No default — fail loud so embeddings never silently route through whichever provider happens to be the AI default.',
    )
  }
  if (!column || typeof column !== 'string') {
    throw new Error('[ai-sdk] similaritySearch requires opts.column — the Model column declared with vector({ dimensions }).')
  }
  if (!model || typeof model.query !== 'function') {
    throw new Error('[ai-sdk] similaritySearch requires opts.model — a Model class with a static query() method.')
  }
  if (limit <= 0 || !Number.isFinite(limit)) {
    throw new Error(`[ai-sdk] similaritySearch limit must be a positive finite number; got ${String(limit)}.`)
  }

  const toolName = name ?? `similarity_search_${model.name.toLowerCase()}`
  const toolDescription = description ?? `Semantic search over ${model.name} records. Pass a natural-language \`query\` string; the most similar rows are returned.`

  return toolDefinition({
    name:        toolName,
    description: toolDescription,
    inputSchema: z.object({
      query: z.string().min(1).describe('Natural-language query to search for.'),
    }),
  })
    .server(async ({ query }): Promise<SimilarityHit<TInstance>[]> => {
      const embedResult = await AI.embed(query, { model: embedWith })
      const vector = embedResult.embeddings[0]
      if (!vector || vector.length === 0) {
        throw new Error(
          `[ai-sdk] similaritySearch: AI.embed("${query}", { model: "${embedWith}" }) returned no embedding.`,
        )
      }

      const baseQb = model.query()
      const scopedQb = scope ? scope(baseQb) : baseQb
      const whereVec = scopedQb.whereVectorSimilarTo
      const selectDist = scopedQb.selectVectorDistance
      if (typeof whereVec !== 'function' || typeof selectDist !== 'function') {
        throw new Error(
          `[ai-sdk] similaritySearch: ${model.name}'s ORM adapter does not implement vector queries. ` +
          'Use @rudderjs/orm-prisma against a Postgres + pgvector connection.',
        )
      }

      const vectorOpts: { metric: 'cosine' | 'l2' | 'inner-product'; minSimilarity?: number } = { metric }
      if (minSimilarity !== undefined) vectorOpts.minSimilarity = minSimilarity

      const filtered = whereVec.call(scopedQb, column, vector, vectorOpts)
      const projected = selectDist.call(filtered, column, vector, SIMILARITY_DISTANCE_ALIAS)
      const rows = await projected.limit(limit).get()

      return rows.map((row): SimilarityHit<TInstance> => {
        const distance = readDistance(row)
        return { row, similarity: 1 - distance }
      })
    })
    .modelOutput((results) => {
      if (results.length === 0) {
        return `No similar ${model.name} records found.`
      }

      if (projectResult) {
        return results
          .map(({ row, similarity }) => projectResult(row, similarity))
          .join('\n')
      }

      return results
        .map(({ row, similarity }) => {
          const json = serializeRow(row)
          return `(${similarity.toFixed(2)}) ${json}`
        })
        .join('\n')
    })
}

function readDistance(row: unknown): number {
  if (row === null || typeof row !== 'object') return 0
  const raw = (row as Record<string, unknown>)[SIMILARITY_DISTANCE_ALIAS]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : 0
}

function serializeRow(row: unknown): string {
  if (row === null || typeof row !== 'object') return JSON.stringify(row)
  const candidate = row as { toJSON?: () => unknown }
  const toJSON = candidate.toJSON
  const data = typeof toJSON === 'function'
    ? toJSON.call(candidate)
    : sanitizeRow(row as Record<string, unknown>)
  return JSON.stringify(data)
}

/**
 * Strip the internal distance alias from rows whose `toJSON` we can't
 * call (plain objects, fakes). `toJSON()`-bearing Models already
 * filter their own internal fields.
 */
function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!(SIMILARITY_DISTANCE_ALIAS in row)) return row
  const { [SIMILARITY_DISTANCE_ALIAS]: _, ...rest } = row
  void _
  return rest
}
