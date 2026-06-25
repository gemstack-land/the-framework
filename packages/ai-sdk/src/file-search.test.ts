/**
 * `fileSearch` agent-tool tests (#B8 Phase 2).
 *
 * - Factory shape (providerHint, marker, schema).
 * - `normalizeWhere` sugar → typed filter shape.
 * - `toOpenAITools` substitutes the native `file_search` block when the
 *   tool's providerHint matches.
 * - Agent-loop integration via AiFake (hosted path: model produces the
 *   final reply directly; no tool round-trip).
 * - Computer-use providerHint propagation through `toolToSchema` (latent
 *   bug fix bundled with this phase).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import {
  fileSearch,
  isFileSearchTool,
  normalizeWhere,
  FILE_SEARCH_MARKER,
  FILE_SEARCH_TOOL_NAME,
  type FileSearchTool,
} from './file-search.js'
import { toOpenAITools } from './providers/openai.js'
import { toolToSchema } from './tool.js'
import type { ToolDefinitionSchema } from './types.js'

// ─── Factory shape ────────────────────────────────────────

describe('fileSearch — factory', () => {
  it('produces a Tool with FILE_SEARCH_MARKER + default name', () => {
    const tool = fileSearch({ stores: ['vs_abc123'] })

    assert.equal(tool[FILE_SEARCH_MARKER], true)
    assert.equal(isFileSearchTool(tool), true)
    assert.equal(tool.definition.name, FILE_SEARCH_TOOL_NAME)
    assert.equal(tool.definition.name, 'file_search')
    assert.ok(tool.definition.description)
  })

  it('accepts custom name + description', () => {
    const tool = fileSearch({
      stores:      ['vs_abc123'],
      name:        'search_docs',
      description: 'Search the docs corpus.',
    })

    assert.equal(tool.definition.name,        'search_docs')
    assert.equal(tool.definition.description, 'Search the docs corpus.')
  })

  it('sets providerHint with vector_store_ids', () => {
    const tool = fileSearch({ stores: ['vs_1', 'vs_2'] })

    assert.equal(tool.definition.providerHint?.type, 'file-search')
    assert.deepEqual(tool.definition.providerHint?.['vector_store_ids'], ['vs_1', 'vs_2'])
    // No filters/max_num_results when unspecified.
    assert.equal(tool.definition.providerHint?.['filters'],         undefined)
    assert.equal(tool.definition.providerHint?.['max_num_results'], undefined)
  })

  it('sets max_num_results when provided', () => {
    const tool = fileSearch({ stores: ['vs_1'], maxResults: 20 })
    assert.equal(tool.definition.providerHint?.['max_num_results'], 20)
  })

  it('lowers sugar `where` into typed filter shape', () => {
    const tool = fileSearch({
      stores: ['vs_1'],
      where:  { author: 'Alice', year: 2026 },
    })

    assert.deepEqual(tool.definition.providerHint?.['filters'], {
      type: 'and',
      filters: [
        { type: 'eq', key: 'author', value: 'Alice' },
        { type: 'eq', key: 'year',   value: 2026    },
      ],
    })
  })

  it('passes typed `where` through unchanged', () => {
    const tool = fileSearch({
      stores: ['vs_1'],
      where:  { type: 'or', filters: [{ type: 'eq', key: 'tag', value: 'a' }, { type: 'eq', key: 'tag', value: 'b' }] },
    })

    assert.deepEqual(tool.definition.providerHint?.['filters'], {
      type: 'or',
      filters: [{ type: 'eq', key: 'tag', value: 'a' }, { type: 'eq', key: 'tag', value: 'b' }],
    })
  })

  it('rejects empty stores array', () => {
    assert.throws(
      () => fileSearch({ stores: [] }),
      /requires at least one vector-store id/,
    )
  })

  it('rejects empty `where` object', () => {
    assert.throws(
      () => fileSearch({ stores: ['vs_1'], where: {} }),
      /must contain at least one key/,
    )
  })

  it('execute is intentionally absent — provider runs the search natively', () => {
    const tool = fileSearch({ stores: ['vs_1'] })
    assert.equal((tool as unknown as { execute?: unknown }).execute, undefined)
  })

  it('placeholder inputSchema accepts { query }', () => {
    const tool = fileSearch({ stores: ['vs_1'] })
    // The placeholder is a zod object; parsing should succeed for { query }
    // and surface as the JSON Schema visible to non-OpenAI providers.
    const parsed = tool.definition.inputSchema.parse({ query: 'hello' })
    assert.deepEqual(parsed, { query: 'hello' })
  })
})

// ─── normalizeWhere ────────────────────────────────────────

describe('normalizeWhere', () => {
  it('single-key sugar short-circuits to bare eq (no and wrapper)', () => {
    assert.deepEqual(normalizeWhere({ author: 'Alice' }), {
      type: 'eq', key: 'author', value: 'Alice',
    })
  })

  it('multi-key sugar wraps in an `and` of `eq`', () => {
    assert.deepEqual(normalizeWhere({ a: 'x', b: 2, c: true }), {
      type: 'and',
      filters: [
        { type: 'eq', key: 'a', value: 'x'  },
        { type: 'eq', key: 'b', value: 2    },
        { type: 'eq', key: 'c', value: true },
      ],
    })
  })

  it('passes typed eq/ne/gt/lt/gte/lte through', () => {
    for (const type of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const) {
      assert.deepEqual(
        normalizeWhere({ type, key: 'year', value: 2026 }),
        { type, key: 'year', value: 2026 },
      )
    }
  })

  it('passes typed and/or through', () => {
    const filter = {
      type: 'and' as const,
      filters: [
        { type: 'gt' as const, key: 'year', value: 2020 },
        { type: 'lt' as const, key: 'year', value: 2027 },
      ],
    }
    assert.deepEqual(normalizeWhere(filter), filter)
  })

  it('throws on empty sugar object', () => {
    assert.throws(() => normalizeWhere({}), /must contain at least one key/)
  })
})

// ─── OpenAI adapter — toOpenAITools substitution ──────────

describe('toOpenAITools — providerHint: file-search', () => {
  it('emits the native file_search block with vector_store_ids', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: {
        type:              'file-search',
        vector_store_ids:  ['vs_abc', 'vs_def'],
      },
    }]

    const out = toOpenAITools(schemas)
    assert.deepEqual(out, [{
      type:             'file_search',
      vector_store_ids: ['vs_abc', 'vs_def'],
    }])
  })

  it('forwards filters + max_num_results when set', () => {
    const filters = {
      type: 'and',
      filters: [{ type: 'eq', key: 'author', value: 'Alice' }],
    }
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: {
        type:              'file-search',
        vector_store_ids:  ['vs_1'],
        filters,
        max_num_results:   10,
      },
    }]

    const out = toOpenAITools(schemas) as Array<{ filters: unknown; max_num_results: number }>
    assert.deepEqual(out[0]!.filters,         filters)
    assert.equal(out[0]!.max_num_results,     10)
  })

  it('omits filters / max_num_results when absent from the hint', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: { type: 'file-search', vector_store_ids: ['vs_1'] },
    }]

    const out = toOpenAITools(schemas) as Array<Record<string, unknown>>
    assert.equal('filters'         in out[0]!, false)
    assert.equal('max_num_results' in out[0]!, false)
  })

  it('falls back to function-call shape when no providerHint', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'get_weather',
      description: 'fetch the current weather',
      parameters:  { type: 'object', properties: { city: { type: 'string' } } },
    }]

    const out = toOpenAITools(schemas)
    assert.deepEqual(out, [{
      type: 'function',
      function: {
        name:        'get_weather',
        description: 'fetch the current weather',
        parameters:  { type: 'object', properties: { city: { type: 'string' } } },
      },
    }])
  })

  it('does NOT substitute when providerHint.type is unrecognized', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'mystery',
      description: '???',
      parameters:  {},
      providerHint: { type: 'unknown-hint' },
    }]

    const out = toOpenAITools(schemas) as Array<{ type: string }>
    assert.equal(out[0]!.type, 'function')
  })
})

// ─── End-to-end: providerHint reaches the adapter via toolToSchema ─

describe('fileSearch — toolToSchema propagates providerHint', () => {
  it('agent loop tool-serialization path includes the hint', () => {
    const tool = fileSearch({ stores: ['vs_1'], maxResults: 5 })
    const schema = toolToSchema(tool)

    assert.equal(schema.name,                            'file_search')
    assert.equal(schema.providerHint?.type,              'file-search')
    assert.deepEqual(schema.providerHint?.['vector_store_ids'], ['vs_1'])
    assert.equal(schema.providerHint?.['max_num_results'], 5)
  })

  it('emits the native block end-to-end through toOpenAITools(toolToSchema(...))', () => {
    const tool = fileSearch({ stores: ['vs_abc'], where: { dept: 'eng' }, maxResults: 3 })
    const out  = toOpenAITools([toolToSchema(tool)]) as Array<{ type: string; vector_store_ids: string[]; filters: unknown; max_num_results: number }>

    assert.equal(out[0]!.type,                  'file_search')
    assert.deepEqual(out[0]!.vector_store_ids,  ['vs_abc'])
    assert.deepEqual(out[0]!.filters,           { type: 'eq', key: 'dept', value: 'eng' })
    assert.equal(out[0]!.max_num_results,       3)
  })
})

// ─── AiFake.respondWithFileSearchResults ──────────────────

describe('AiFake.respondWithFileSearchResults', () => {
  it('returns the supplied text verbatim through an agent', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({ text: 'The policy expires on 2027-03-01.' })

    class KnowledgeAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KnowledgeAgent().prompt('When does the policy expire?')
    assert.equal(response.text, 'The policy expires on 2027-03-01.')

    fake.restore()
  })

  it('formats hits into a readable assistant reply', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({
      hits: [
        { text: 'Policies renew annually.', source: 'policy.pdf', score: 0.92 },
        { text: 'Renewal happens in March.', source: 'renewal.pdf' },
      ],
    })

    class KbAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('How do renewals work?')
    assert.match(response.text, /Policies renew annually/)
    assert.match(response.text, /Renewal happens in March/)
    assert.match(response.text, /\(0\.92\)/)
    assert.match(response.text, /policy\.pdf/)

    fake.restore()
  })

  it('returns a no-results message when hits is empty', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({ hits: [] })

    class KbAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('Anything on quantum widgets?')
    assert.equal(response.text, 'No relevant documents found.')

    fake.restore()
  })

  it('flows token usage to the AgentResponse when provided', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({
      text:  'Result.',
      usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
    })

    class KbAgent extends Agent {
      instructions() { return 'Answer.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('x')
    assert.equal(response.usage.totalTokens, 105)

    fake.restore()
  })
})

// ─── Latent bug fix bundled with B8 P2: computer-use providerHint
//     now propagates through the agent loop via toolToSchema. ───────

describe('toolToSchema — propagates definition.providerHint generally', () => {
  it('copies providerHint from definition onto the emitted schema', () => {
    const stubTool = {
      definition: {
        name:         'x',
        description:  'y',
        inputSchema:  z.object({}),
        providerHint: { type: 'file-search', vector_store_ids: ['vs_x'] },
      },
    }
    const schema = toolToSchema(stubTool as unknown as { definition: import('./types.js').ToolDefinitionOptions })
    assert.equal(schema.providerHint?.type, 'file-search')
    assert.deepEqual(schema.providerHint?.['vector_store_ids'], ['vs_x'])
  })

  it('omits providerHint when definition has none', () => {
    const stubTool = {
      definition: {
        name:        'x',
        description: 'y',
        inputSchema: z.object({}),
      },
    }
    const schema = toolToSchema(stubTool as unknown as { definition: import('./types.js').ToolDefinitionOptions })
    assert.equal(schema.providerHint, undefined)
  })
})

// ─── Phase 3 — local pgvector fallback ────────────────────
//
// When `fallback` is set, the returned FileSearchTool gains an `execute`
// (delegating to similaritySearch) AND a `toModelOutput` projection, while
// preserving the providerHint. The cascade is automatic: OpenAI's adapter
// emits the native block (model never invokes execute), other providers
// emit a function-call schema (model invokes execute → similaritySearch
// runs locally).

import { beforeEach, afterEach } from 'node:test'
import type {
  SimilaritySearchModel,
  SimilaritySearchQueryBuilder,
} from './similarity-search.js'

interface DocRow {
  id:                                   number
  content:                              string
  __rudderjs_similarity_distance__?:    number
}

interface QbCalls {
  whereVectorSimilarTo?: { column: string; query: number[] | string; opts: unknown }
  selectVectorDistance?: { column: string; query: number[]; alias:  string }
  limit?:                number
}

function fakeDocumentModel(rows: DocRow[], calls: QbCalls = {}): SimilaritySearchModel<DocRow> {
  const qb: SimilaritySearchQueryBuilder<DocRow> = {
    where: () => qb, orWhere: () => qb,
    whereVectorSimilarTo(column, query, opts) {
      calls.whereVectorSimilarTo = { column, query, opts: opts ?? null }
      return qb
    },
    selectVectorDistance(column, query, alias) {
      calls.selectVectorDistance = { column, query, alias }
      return qb
    },
    limit(n) { calls.limit = n; return qb },
    get: async () => rows,
  }
  return { name: 'Document', query: () => qb }
}

describe('fileSearch — fallback (Phase 3)', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => { fake.restore() })

  it('without fallback, execute remains undefined (back-compat with Phase 2)', () => {
    const tool = fileSearch({ stores: ['vs_1'] })
    assert.equal((tool as { execute?: unknown }).execute, undefined)
    assert.equal((tool as { toModelOutput?: unknown }).toModelOutput, undefined)
  })

  it('with fallback, execute + toModelOutput are lifted from similaritySearch', () => {
    const tool = fileSearch({
      stores: ['vs_1'],
      fallback: {
        model:     fakeDocumentModel([]),
        column:    'embedding',
        embedWith: '__fake__/embed',
      },
    })
    assert.equal(typeof (tool as { execute?: unknown }).execute,       'function')
    assert.equal(typeof (tool as { toModelOutput?: unknown }).toModelOutput, 'function')
  })

  it('preserves providerHint when fallback is set (OpenAI native still wins)', () => {
    const tool = fileSearch({
      stores:     ['vs_kb'],
      where:      { dept: 'eng' },
      maxResults: 5,
      fallback: {
        model:     fakeDocumentModel([]),
        column:    'embedding',
        embedWith: '__fake__/embed',
      },
    })
    assert.equal(tool.definition.providerHint?.type,                  'file-search')
    assert.deepEqual(tool.definition.providerHint?.['vector_store_ids'], ['vs_kb'])
    assert.deepEqual(tool.definition.providerHint?.['filters'],          { type: 'eq', key: 'dept', value: 'eng' })
    assert.equal(tool.definition.providerHint?.['max_num_results'],     5)

    // toOpenAITools still substitutes the native block — execute is dead
    // weight on the OpenAI path because the model never invokes the
    // function-call tool.
    const native = toOpenAITools([toolToSchema(tool)]) as Array<{ type: string }>
    assert.equal(native[0]!.type, 'file_search')
  })

  it('execute embeds the query and delegates to similaritySearch internals', async () => {
    const calls: QbCalls = {}
    const rows: DocRow[] = [
      { id: 1, content: 'first',  __rudderjs_similarity_distance__: 0.10 },
      { id: 2, content: 'second', __rudderjs_similarity_distance__: 0.30 },
    ]
    fake.respondWithEmbedding([[0.5, 0.5]])

    const tool = fileSearch({
      stores: ['vs_kb'],
      fallback: {
        model:     fakeDocumentModel(rows, calls),
        column:    'embedding',
        embedWith: '__fake__/embed',
        limit:     3,
      },
    })

    const execute = (tool as { execute: (input: { query: string }) => Promise<unknown> }).execute
    const result  = await execute({ query: 'how do renewals work?' }) as Array<{ row: DocRow; similarity: number }>

    // Embedding flowed to the QB.
    assert.deepEqual(calls.whereVectorSimilarTo?.column, 'embedding')
    assert.deepEqual(calls.whereVectorSimilarTo?.query,  [0.5, 0.5])
    assert.equal(calls.limit, 3)

    // Hits come back as SimilarityHit[] (similarity = 1 - distance).
    assert.equal(result.length, 2)
    assert.equal(result[0]!.row.id,        1)
    assert.equal(result[0]!.similarity.toFixed(2), '0.90')
    assert.equal(result[1]!.row.id,        2)
    assert.equal(result[1]!.similarity.toFixed(2), '0.70')
  })

  it('toModelOutput projects hits into the (similarity) {json} shape the model sees', async () => {
    const rows: DocRow[] = [
      { id: 1, content: 'first',  __rudderjs_similarity_distance__: 0.20 },
    ]
    fake.respondWithEmbedding([[1, 0]])

    const tool = fileSearch({
      stores: ['vs_kb'],
      fallback: {
        model:     fakeDocumentModel(rows),
        column:    'embedding',
        embedWith: '__fake__/embed',
      },
    })

    const execute       = (tool as { execute: (input: { query: string }) => Promise<unknown> }).execute
    const toModelOutput = (tool as { toModelOutput: (result: unknown) => string | Promise<string> }).toModelOutput
    const hits   = await execute({ query: 'q' })
    const output = await toModelOutput(hits)

    assert.match(output, /\(0\.80\)/)
    assert.match(output, /"id":1/)
    assert.match(output, /"content":"first"/)
    // Internal distance alias stripped from the JSON projection.
    assert.equal(output.includes('__rudderjs_similarity_distance__'), false)
  })

  it('honors fallback.scope for tenancy / pre-filter chains', async () => {
    const wheres: Array<{ column: string; value: unknown }> = []
    const qb: SimilaritySearchQueryBuilder<DocRow> = {
      where(column: string, opOrVal: unknown, value?: unknown) {
        const val = arguments.length === 3 ? value : opOrVal
        wheres.push({ column, value: val })
        return qb
      },
      orWhere: () => qb,
      whereVectorSimilarTo: () => qb,
      selectVectorDistance: () => qb,
      limit: () => qb,
      get: async () => [],
    }
    const model: SimilaritySearchModel<DocRow> = { name: 'Document', query: () => qb }
    fake.respondWithEmbedding([[0.1]])

    const tool = fileSearch({
      stores: ['vs_kb'],
      fallback: {
        model,
        column:    'embedding',
        embedWith: '__fake__/embed',
        scope:     q => q.where('tenantId', 'tenant_42').where('published', true),
      },
    })

    const execute = (tool as { execute: (input: { query: string }) => Promise<unknown> }).execute
    await execute({ query: 'q' })

    assert.deepEqual(wheres, [
      { column: 'tenantId',  value: 'tenant_42' },
      { column: 'published', value: true        },
    ])
  })

  it('execute throws if the fallback model has no vector-query adapter', async () => {
    const noVectorModel: SimilaritySearchModel<DocRow> = {
      name: 'Document',
      query: () => ({
        where: () => noVectorModel.query(), orWhere: () => noVectorModel.query(),
        limit: () => noVectorModel.query(), get: async () => [],
      } as unknown as SimilaritySearchQueryBuilder<DocRow>),
    }
    fake.respondWithEmbedding([[0.1]])

    const tool = fileSearch({
      stores: ['vs_kb'],
      fallback: { model: noVectorModel, column: 'embedding', embedWith: '__fake__/embed' },
    })
    const execute = (tool as { execute: (input: { query: string }) => Promise<unknown> }).execute

    await assert.rejects(execute({ query: 'q' }), /does not implement vector queries/)
  })
})
