import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { AiFake } from './fake.js'
import { similaritySearch } from './similarity-search.js'
import type {
  SimilarityHit,
  SimilaritySearchModel,
  SimilaritySearchQueryBuilder,
} from './similarity-search.js'

// ─── Test doubles ─────────────────────────────────────────

interface DocumentRow {
  id:       number
  content:  string
  __rudderjs_similarity_distance__?: number
  toJSON?(): unknown
}

/** Records every QB call so tests can assert the SQL-builder shape. */
interface QbTrace {
  wheres?:               Array<{ column: string; operator: string; value: unknown }>
  orWheres?:             Array<{ column: string; operator: string; value: unknown }>
  whereVectorSimilarTo?: { column: string; query: number[] | string; opts: unknown }
  selectVectorDistance?: { column: string; query: number[]; alias: string }
  limit?:                number
}

function makeFakeModel(opts: {
  rows: DocumentRow[]
  trace?: QbTrace
} = { rows: [] }): SimilaritySearchModel<DocumentRow> {
  const trace = opts.trace ?? {}
  trace.wheres   ??= []
  trace.orWheres ??= []

  function makeQb(): SimilaritySearchQueryBuilder<DocumentRow> {
    const qb = {
      where(column: string, opOrVal: unknown, value?: unknown): SimilaritySearchQueryBuilder<DocumentRow> {
        const operator = arguments.length === 3 ? String(opOrVal) : '='
        const val      = arguments.length === 3 ? value : opOrVal
        trace.wheres!.push({ column, operator, value: val })
        return qb
      },
      orWhere(column: string, opOrVal: unknown, value?: unknown): SimilaritySearchQueryBuilder<DocumentRow> {
        const operator = arguments.length === 3 ? String(opOrVal) : '='
        const val      = arguments.length === 3 ? value : opOrVal
        trace.orWheres!.push({ column, operator, value: val })
        return qb
      },
      whereVectorSimilarTo(column: string, query: number[] | string, opts2?: unknown): SimilaritySearchQueryBuilder<DocumentRow> {
        trace.whereVectorSimilarTo = { column, query, opts: opts2 ?? null }
        return qb
      },
      selectVectorDistance(column: string, query: number[], alias: string): SimilaritySearchQueryBuilder<DocumentRow> {
        trace.selectVectorDistance = { column, query, alias }
        return qb
      },
      limit(n: number): SimilaritySearchQueryBuilder<DocumentRow> {
        trace.limit = n
        return qb
      },
      get: async () => opts.rows,
    } as unknown as SimilaritySearchQueryBuilder<DocumentRow>
    return qb
  }

  return {
    name: 'Document',
    query: makeQb,
  }
}

// ─── Factory validation ───────────────────────────────────

describe('similaritySearch — factory validation', () => {
  it('throws when embedWith is missing', () => {
    const model = makeFakeModel()
    assert.throws(
      () => similaritySearch({ model, column: 'embedding' } as unknown as Parameters<typeof similaritySearch>[0]),
      /embedWith/,
    )
  })

  it('throws when embedWith is empty string', () => {
    const model = makeFakeModel()
    assert.throws(
      () => similaritySearch({ model, column: 'embedding', embedWith: '' }),
      /embedWith/,
    )
  })

  it('throws when column is missing', () => {
    const model = makeFakeModel()
    assert.throws(
      () => similaritySearch({ model, embedWith: '__fake__/embed' } as unknown as Parameters<typeof similaritySearch>[0]),
      /column/,
    )
  })

  it('throws when model has no query()', () => {
    assert.throws(
      () => similaritySearch({
        model: { name: 'Bad' } as unknown as SimilaritySearchModel<DocumentRow>,
        column: 'embedding',
        embedWith: '__fake__/embed',
      }),
      /model/,
    )
  })

  it('throws when limit is zero or negative', () => {
    const model = makeFakeModel()
    assert.throws(
      () => similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed', limit: 0 }),
      /limit/,
    )
    assert.throws(
      () => similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed', limit: -5 }),
      /limit/,
    )
  })
})

// ─── Tool definition shape ────────────────────────────────

describe('similaritySearch — tool definition', () => {
  it('uses default tool name `similarity_search_<model>`', () => {
    const model = makeFakeModel()
    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    assert.equal(tool.definition.name, 'similarity_search_document')
  })

  it('honors a custom tool name', () => {
    const model = makeFakeModel()
    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      name: 'find_similar_docs',
    })
    assert.equal(tool.definition.name, 'find_similar_docs')
  })

  it('honors a custom tool description', () => {
    const model = makeFakeModel()
    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      description: 'Custom description',
    })
    assert.equal(tool.definition.description, 'Custom description')
  })

  it('mentions the model name in the default description', () => {
    const model = makeFakeModel()
    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    assert.match(tool.definition.description, /Document/)
  })

  it('rejects empty query strings via input schema', async () => {
    const model = makeFakeModel()
    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const schema = tool.definition.inputSchema
    const result = schema.safeParse({ query: '' })
    assert.equal(result.success, false)
  })

  it('accepts a non-empty query string', async () => {
    const model = makeFakeModel()
    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const schema = tool.definition.inputSchema
    const result = schema.safeParse({ query: 'hello world' })
    assert.equal(result.success, true)
  })
})

// ─── Execute path ────────────────────────────────────────

describe('similaritySearch — execute', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => { fake.restore() })

  it('embeds the query and forwards the vector to whereVectorSimilarTo', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[0.1, 0.2, 0.3]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      limit: 5,
    })
    const result = await tool.execute({ query: 'how do I reset my password?' })

    assert.deepEqual(trace.whereVectorSimilarTo?.column, 'embedding')
    assert.deepEqual(trace.whereVectorSimilarTo?.query, [0.1, 0.2, 0.3])
    assert.equal(trace.limit, 5)
    assert.deepEqual(result, [])
  })

  it('forwards metric to whereVectorSimilarTo', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      metric: 'l2',
    })
    await tool.execute({ query: 'q' })

    assert.equal((trace.whereVectorSimilarTo?.opts as { metric: string } | null)?.metric, 'l2')
  })

  it('forwards minSimilarity to whereVectorSimilarTo', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      minSimilarity: 0.7,
    })
    await tool.execute({ query: 'q' })

    assert.equal((trace.whereVectorSimilarTo?.opts as { minSimilarity: number } | null)?.minSimilarity, 0.7)
  })

  it('always projects the internal distance alias for similarity readback', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    await tool.execute({ query: 'q' })

    assert.equal(trace.selectVectorDistance?.column, 'embedding')
    assert.deepEqual(trace.selectVectorDistance?.query, [1, 0])
    assert.equal(trace.selectVectorDistance?.alias, '__rudderjs_similarity_distance__')
  })

  it('default limit is 10 when none specified', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    await tool.execute({ query: 'q' })

    assert.equal(trace.limit, 10)
  })

  it('returns SimilarityHit[] with similarity = 1 - distance from each row', async () => {
    const rows: DocumentRow[] = [
      { id: 1, content: 'first',  __rudderjs_similarity_distance__: 0.1 },
      { id: 2, content: 'second', __rudderjs_similarity_distance__: 0.4 },
    ]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const result = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]

    assert.equal(result.length, 2)
    assert.equal(result[0]!.row.id, 1)
    assert.ok(Math.abs(result[0]!.similarity - 0.9) < 1e-9, `expected ~0.9, got ${result[0]!.similarity}`)
    assert.ok(Math.abs(result[1]!.similarity - 0.6) < 1e-9, `expected ~0.6, got ${result[1]!.similarity}`)
  })

  it('treats missing distance alias as zero distance (similarity = 1)', async () => {
    const rows: DocumentRow[] = [{ id: 1, content: 'no distance' }]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const result = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]

    assert.equal(result[0]!.similarity, 1)
  })

  it('throws when AI.embed returns no embedding', async () => {
    const model = makeFakeModel()
    fake.respondWithEmbedding([])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    await assert.rejects(
      async () => { await tool.execute({ query: 'q' }) },
      /no embedding/i,
    )
  })

  it('throws when the model adapter does not implement vector queries', async () => {
    const badModel: SimilaritySearchModel<DocumentRow> = {
      name: 'Bad',
      query: () => ({
        limit: () => ({} as unknown as SimilaritySearchQueryBuilder<DocumentRow>),
        get: async () => [],
      } as unknown as SimilaritySearchQueryBuilder<DocumentRow>),
    }
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model: badModel, column: 'embedding', embedWith: '__fake__/embed' })
    await assert.rejects(
      async () => { await tool.execute({ query: 'q' }) },
      /vector queries/i,
    )
  })
})

// ─── modelOutput projection ──────────────────────────────

describe('similaritySearch — modelOutput', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => { fake.restore() })

  it('default formatter renders `(0.85) {json}` per hit, newline-joined', async () => {
    const rows: DocumentRow[] = [
      { id: 1, content: 'first',  __rudderjs_similarity_distance__: 0.15 },
      { id: 2, content: 'second', __rudderjs_similarity_distance__: 0.30 },
    ]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const hits = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]
    const output = await tool.toModelOutput!(hits)

    const lines = output.split('\n')
    assert.equal(lines.length, 2)
    assert.match(lines[0]!, /^\(0\.85\) /)
    assert.match(lines[0]!, /"id":1/)
    assert.match(lines[1]!, /^\(0\.70\) /)
  })

  it('default formatter strips the internal distance alias from the JSON', async () => {
    const rows: DocumentRow[] = [{ id: 1, content: 'first', __rudderjs_similarity_distance__: 0.1 }]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const hits = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]
    const output = await tool.toModelOutput!(hits)

    assert.doesNotMatch(output, /__rudderjs_similarity_distance__/)
  })

  it('honors a custom projectResult', async () => {
    const rows: DocumentRow[] = [
      { id: 1, content: 'apples',  __rudderjs_similarity_distance__: 0.1 },
      { id: 2, content: 'bananas', __rudderjs_similarity_distance__: 0.4 },
    ]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      projectResult: (row, sim) => `${row.content} @ ${sim.toFixed(1)}`,
    })
    const hits = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]
    const output = await tool.toModelOutput!(hits)

    assert.equal(output, 'apples @ 0.9\nbananas @ 0.6')
  })

  it('returns empty-state message when no rows matched', async () => {
    const model = makeFakeModel()
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const hits = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]
    const output = await tool.toModelOutput!(hits)

    assert.match(output, /No similar Document records found/)
  })

  it('uses row.toJSON() when available (skips internal field via Model serialization)', async () => {
    const rows: DocumentRow[] = [{
      id: 1,
      content: 'serialized',
      __rudderjs_similarity_distance__: 0.1,
      toJSON() { return { id: 1, content: 'serialized' } },
    }]
    const model = makeFakeModel({ rows })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    const hits = (await tool.execute({ query: 'q' })) as SimilarityHit<DocumentRow>[]
    const output = await tool.toModelOutput!(hits)

    assert.match(output, /"id":1/)
    assert.match(output, /"content":"serialized"/)
    assert.doesNotMatch(output, /__rudderjs/)
  })
})

// ─── scope callback (#B7 Phase 2.5) ──────────────────────

describe('similaritySearch — scope callback', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => { fake.restore() })

  it('calls scope before whereVectorSimilarTo and applies the .where() chain', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      scope: (q) => q.where('tenantId', 42).where('published', true),
    })
    await tool.execute({ query: 'q' })

    assert.deepEqual(trace.wheres, [
      { column: 'tenantId',  operator: '=', value: 42 },
      { column: 'published', operator: '=', value: true },
    ])
    // Vector clause still attached after the scope chain.
    assert.equal(trace.whereVectorSimilarTo?.column, 'embedding')
  })

  it('forwards the WhereOperator overload through scope', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      scope: (q) => q.where('priority', '>=', 5).where('id', 'IN', [1, 2, 3]),
    })
    await tool.execute({ query: 'q' })

    assert.deepEqual(trace.wheres, [
      { column: 'priority', operator: '>=', value: 5 },
      { column: 'id',       operator: 'IN', value: [1, 2, 3] },
    ])
  })

  it('honors scope returning .orWhere()', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      scope: (q) => q.where('tenantId', 1).orWhere('shared', true),
    })
    await tool.execute({ query: 'q' })

    assert.equal(trace.wheres?.length, 1)
    assert.equal(trace.orWheres?.length, 1)
    assert.deepEqual(trace.orWheres?.[0], { column: 'shared', operator: '=', value: true })
  })

  it('no scope = no .where() calls (back-compat with Phase 2 omit-scope behavior)', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({ model, column: 'embedding', embedWith: '__fake__/embed' })
    await tool.execute({ query: 'q' })

    assert.equal(trace.wheres?.length, 0)
    assert.equal(trace.orWheres?.length, 0)
  })

  it('scope receives a builder it can return verbatim', async () => {
    const trace: QbTrace = {}
    const model = makeFakeModel({ rows: [], trace })
    fake.respondWithEmbedding([[1, 0]])

    const tool = similaritySearch({
      model, column: 'embedding', embedWith: '__fake__/embed',
      scope: (q) => q,   // identity
    })
    await tool.execute({ query: 'q' })

    assert.equal(trace.whereVectorSimilarTo?.column, 'embedding')
    assert.equal(trace.wheres?.length, 0)
  })
})
