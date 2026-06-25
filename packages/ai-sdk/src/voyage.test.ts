/**
 * Voyage provider tests (#B10).
 *
 * Mocks `globalThis.fetch` to capture request shape and stub responses.
 * Verifies:
 *  - `create()` throws (no chat completions on this provider).
 *  - Embed request: URL, Bearer header, JSON body (model + input array +
 *    input_type), default `'document'` input_type with override via
 *    `defaultInputType` config.
 *  - Embed response decode: data sorted by index, embeddings array,
 *    usage.total_tokens → promptTokens/totalTokens.
 *  - String vs string[] input both produce `input` as an array.
 *  - Rerank request: URL, Bearer header, JSON body (model + query +
 *    documents + optional top_k).
 *  - Rerank response decode: results map relevance_score → relevanceScore,
 *    document falls back to original input by index when API omits echo.
 *  - Error responses surface readable messages with the HTTP status.
 *  - baseUrl override.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { VoyageProvider } from './providers/voyage.js'

interface FetchCall {
  url:     string
  method:  string
  headers: Record<string, string>
  body:    unknown
}

let fetchCalls: FetchCall[] = []
let nextResponse: Response | undefined
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis)

beforeEach(() => {
  fetchCalls   = []
  nextResponse = undefined
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url     = typeof input === 'string' ? input : (input as { toString(): string }).toString()
    const method  = init?.method ?? 'GET'
    const headers = headersToObject(init?.headers)
    fetchCalls.push({ url, method, headers, body: init?.body })
    if (!nextResponse) throw new Error(`unmocked fetch: ${method} ${url}`)
    return nextResponse
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

function stubJson(body: unknown, status = 200): void {
  nextResponse = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubError(status: number, body: string): void {
  nextResponse = new Response(body, { status })
}

function headersToObject(h: unknown): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => { out[k] = v })
    return out
  }
  if (Array.isArray(h)) return Object.fromEntries(h as Array<[string, string]>)
  return { ...h as Record<string, string> }
}

// ─── Provider shape ──────────────────────────────────────

describe('VoyageProvider', () => {
  it('create() throws — no chat completions surface', () => {
    const p = new VoyageProvider({ apiKey: 'sk-test' })
    assert.throws(() => p.create('any-model'), /does not support text generation/)
  })

  it('createEmbedding() returns an EmbeddingAdapter', () => {
    const p = new VoyageProvider({ apiKey: 'sk-test' })
    const a = p.createEmbedding('voyage-3')
    assert.equal(typeof a.embed, 'function')
  })

  it('createReranking() returns a RerankingAdapter', () => {
    const p = new VoyageProvider({ apiKey: 'sk-test' })
    const a = p.createReranking('rerank-2.5')
    assert.equal(typeof a.rerank, 'function')
  })
})

// ─── Embeddings ──────────────────────────────────────────

describe('Voyage embeddings — embed()', () => {
  it('hits /v1/embeddings with Bearer auth + JSON body (default input_type document)', async () => {
    stubJson({
      data: [
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
      ],
      usage: { total_tokens: 12 },
    })
    const p = new VoyageProvider({ apiKey: 'sk-test' })
    const r = await p.createEmbedding('voyage-3-large').embed(['hello', 'world'], 'voyage-3-large')

    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]!
    assert.match(call.url, /\/v1\/embeddings$/)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['Authorization'], 'Bearer sk-test')
    assert.equal(call.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(call.body as string), {
      model:      'voyage-3-large',
      input:      ['hello', 'world'],
      input_type: 'document',
    })

    assert.deepEqual(r.embeddings, [[0.1, 0.2], [0.3, 0.4]])
    assert.equal(r.usage.totalTokens,  12)
    assert.equal(r.usage.promptTokens, 12)
  })

  it('wraps a single string into a single-element input array', async () => {
    stubJson({ data: [{ embedding: [0.5], index: 0 }], usage: { total_tokens: 1 } })
    await new VoyageProvider({ apiKey: 'sk-test' }).createEmbedding('voyage-3').embed('only one', 'voyage-3')

    const body = JSON.parse(fetchCalls[0]!.body as string) as { input: unknown }
    assert.deepEqual(body.input, ['only one'])
  })

  it('honors defaultInputType override (query)', async () => {
    stubJson({ data: [{ embedding: [0], index: 0 }], usage: { total_tokens: 0 } })
    await new VoyageProvider({ apiKey: 'sk-test', defaultInputType: 'query' })
      .createEmbedding('voyage-3').embed('q', 'voyage-3')

    assert.equal(JSON.parse(fetchCalls[0]!.body as string).input_type, 'query')
  })

  it('sorts response embeddings by index when API returns out of order', async () => {
    stubJson({
      data: [
        { embedding: [3], index: 2 },
        { embedding: [1], index: 0 },
        { embedding: [2], index: 1 },
      ],
      usage: { total_tokens: 3 },
    })
    const r = await new VoyageProvider({ apiKey: 'sk-test' })
      .createEmbedding('voyage-3').embed(['a', 'b', 'c'], 'voyage-3')

    assert.deepEqual(r.embeddings, [[1], [2], [3]])
  })

  it('handles zero-token usage gracefully', async () => {
    stubJson({ data: [{ embedding: [0.1], index: 0 }] })
    const r = await new VoyageProvider({ apiKey: 'sk-test' })
      .createEmbedding('voyage-3').embed('x', 'voyage-3')
    assert.equal(r.usage.totalTokens,  0)
    assert.equal(r.usage.promptTokens, 0)
  })

  it('honors baseUrl override', async () => {
    stubJson({ data: [], usage: { total_tokens: 0 } })
    await new VoyageProvider({ apiKey: 'sk-test', baseUrl: 'https://gateway.example.com' })
      .createEmbedding('voyage-3').embed('x', 'voyage-3')
    assert.match(fetchCalls[0]!.url, /^https:\/\/gateway\.example\.com\/v1\/embeddings$/)
  })

  it('surfaces non-2xx errors with status + body', async () => {
    stubError(401, 'invalid API key')
    await assert.rejects(
      new VoyageProvider({ apiKey: 'sk-bad' }).createEmbedding('voyage-3').embed('x', 'voyage-3'),
      /Voyage embed failed \(401\): invalid API key/,
    )
  })
})

// ─── Reranking ───────────────────────────────────────────

describe('Voyage reranking — rerank()', () => {
  it('hits /v1/rerank with Bearer auth + JSON body, forwards top_k', async () => {
    stubJson({
      data: [
        { index: 1, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.10 },
      ],
      usage: { total_tokens: 25 },
    })
    const p = new VoyageProvider({ apiKey: 'sk-test' })
    const r = await p.createReranking('rerank-2.5').rerank({
      query:     'how do I reset my password?',
      documents: ['change account name', 'reset password procedure'],
      topK:      5,
    })

    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]!
    assert.match(call.url, /\/v1\/rerank$/)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['Authorization'], 'Bearer sk-test')
    assert.deepEqual(JSON.parse(call.body as string), {
      model:     'rerank-2.5',
      query:     'how do I reset my password?',
      documents: ['change account name', 'reset password procedure'],
      top_k:     5,
    })

    // Result preserves API order (sorted by relevance) — index points
    // back to the original document.
    assert.deepEqual(r.results, [
      { index: 1, relevanceScore: 0.95, document: 'reset password procedure' },
      { index: 0, relevanceScore: 0.10, document: 'change account name'      },
    ])
    assert.deepEqual(r.usage, { tokens: 25 })
  })

  it('omits top_k from the request when not provided', async () => {
    stubJson({ data: [], usage: { total_tokens: 0 } })
    await new VoyageProvider({ apiKey: 'sk-test' })
      .createReranking('rerank-2.5')
      .rerank({ query: 'q', documents: ['a', 'b'] })

    const body = JSON.parse(fetchCalls[0]!.body as string)
    assert.equal('top_k' in body, false)
  })

  it('prefers Voyage-echoed document text when present', async () => {
    stubJson({
      data: [
        // Hypothetical future API: server returns `document` even though our
        // input was already text. Adapter should prefer the echo.
        { index: 0, relevance_score: 0.5, document: 'echoed-by-server' },
      ],
      usage: { total_tokens: 0 },
    })
    const r = await new VoyageProvider({ apiKey: 'sk-test' })
      .createReranking('rerank-2.5')
      .rerank({ query: 'q', documents: ['original-input'] })

    assert.equal(r.results[0]!.document, 'echoed-by-server')
  })

  it('omits usage from the result when API omits it', async () => {
    stubJson({ data: [{ index: 0, relevance_score: 0.9 }] })
    const r = await new VoyageProvider({ apiKey: 'sk-test' })
      .createReranking('rerank-2.5')
      .rerank({ query: 'q', documents: ['a'] })
    assert.equal(r.usage, undefined)
  })

  it('honors baseUrl override', async () => {
    stubJson({ data: [], usage: { total_tokens: 0 } })
    await new VoyageProvider({ apiKey: 'sk-test', baseUrl: 'https://gateway.example.com' })
      .createReranking('rerank-2.5')
      .rerank({ query: 'q', documents: [] })
    assert.match(fetchCalls[0]!.url, /^https:\/\/gateway\.example\.com\/v1\/rerank$/)
  })

  it('surfaces non-2xx errors with status + body', async () => {
    stubError(429, 'Rate limit exceeded')
    await assert.rejects(
      new VoyageProvider({ apiKey: 'sk-test' })
        .createReranking('rerank-2.5')
        .rerank({ query: 'q', documents: ['a'] }),
      /Voyage rerank failed \(429\): Rate limit exceeded/,
    )
  })
})
