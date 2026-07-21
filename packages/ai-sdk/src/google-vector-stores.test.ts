/**
 * Gemini hosted vector-stores (#B8.5).
 *
 * Three concerns:
 *  - `filterToGeminiString` translates OpenAI-shaped typed filters into
 *    Gemini's `metadataFilter` string syntax.
 *  - `attributesToCustomMetadata` / `customMetadataToAttributes` round-trip
 *    the flat-attribute shape through Gemini's `CustomMetadata[]`.
 *  - `GoogleVectorStoreAdapter` wraps the `@google/genai` SDK's
 *    `fileSearchStores.*` surface — tested with a hand-rolled fake client
 *    swapped in via the `client` field on the adapter instance.
 *  - `toGeminiTools` emits the native `fileSearch` block when a tool
 *    carries `providerHint.type === 'file-search'`.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  GoogleProvider,
  filterToGeminiString,
  attributesToCustomMetadata,
  customMetadataToAttributes,
  fromGeminiFileSearchStore,
  fromGeminiDocument,
  mimeTypeFromFilename,
} from './providers/google.js'
import { fileSearch } from './file-search.js'
import { toolToSchema } from './tool.js'
import type { ToolDefinitionSchema, VectorStoreAdapter } from './types.js'
import type { FileSearchFilter } from './file-search.js'

// Reuse the project's `toGeminiTools` through the public façade: it's only
// called from within `GoogleAdapter`, not exported. We exercise it
// end-to-end through the providerHint→native-block path instead.
async function emitToolBlock(schema: ToolDefinitionSchema): Promise<unknown[]> {
  // Re-implement the call path by reaching into the adapter's payload
  // build. Simpler: emit by calling the same function indirectly via the
  // already-exported helper. Since `toGeminiTools` is module-private, we
  // re-trigger it by constructing an adapter, mocking the client, and
  // capturing the `tools` argument that lands on `generateContent`.
  const provider = new GoogleProvider({ apiKey: 'k' })
  const adapter  = provider.create('gemini-2.5-flash')

  let captured: Record<string, unknown> | null = null
  const fakeClient = {
    models: {
      async generateContent(payload: Record<string, unknown>) {
        captured = payload
        return {
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        }
      },
    },
  }
  ;(adapter as unknown as { getClient: { set(c: unknown): void } }).getClient.set(fakeClient)

  await adapter.generate({
    model:    'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hi' }],
    tools:    [schema],
  })

  const cfg = (captured as Record<string, unknown> | null)?.['config'] as Record<string, unknown> | undefined
  return (cfg?.['tools'] as unknown[] | undefined) ?? []
}

// ─── filterToGeminiString ────────────────────────────────

describe('filterToGeminiString', () => {
  it('translates eq with a string value (quoted + escaped)', () => {
    assert.equal(
      filterToGeminiString({ type: 'eq', key: 'author', value: 'Alice' }),
      'author = "Alice"',
    )
  })

  it('translates eq with a numeric value (bare)', () => {
    assert.equal(
      filterToGeminiString({ type: 'eq', key: 'year', value: 2026 }),
      'year = 2026',
    )
  })

  it('translates eq with a boolean value (bare)', () => {
    assert.equal(
      filterToGeminiString({ type: 'eq', key: 'published', value: true }),
      'published = true',
    )
  })

  it('translates all comparison operators', () => {
    const cases: Array<[FileSearchFilter['type'], string]> = [
      ['eq',  '='],
      ['ne',  '!='],
      ['gt',  '>'],
      ['gte', '>='],
      ['lt',  '<'],
      ['lte', '<='],
    ]
    for (const [type, op] of cases) {
      assert.equal(
        // The leaf-variant type literals are part of one union — narrow via cast.
        filterToGeminiString({ type, key: 'year', value: 2020 } as FileSearchFilter),
        `year ${op} 2020`,
      )
    }
  })

  it('escapes double quotes and backslashes in string values', () => {
    assert.equal(
      filterToGeminiString({ type: 'eq', key: 'title', value: 'She said "hi"\\bye' }),
      'title = "She said \\"hi\\"\\\\bye"',
    )
  })

  it('translates AND with two sub-filters, parenthesized', () => {
    assert.equal(
      filterToGeminiString({
        type: 'and',
        filters: [
          { type: 'eq', key: 'author', value: 'Alice' },
          { type: 'gt', key: 'year',   value: 2020    },
        ],
      }),
      '(author = "Alice") AND (year > 2020)',
    )
  })

  it('translates OR with three sub-filters, parenthesized', () => {
    assert.equal(
      filterToGeminiString({
        type: 'or',
        filters: [
          { type: 'eq', key: 'tag', value: 'a' },
          { type: 'eq', key: 'tag', value: 'b' },
          { type: 'eq', key: 'tag', value: 'c' },
        ],
      }),
      '(tag = "a") OR (tag = "b") OR (tag = "c")',
    )
  })

  it('handles nested AND/OR groups', () => {
    assert.equal(
      filterToGeminiString({
        type: 'and',
        filters: [
          { type: 'eq', key: 'dept', value: 'eng' },
          {
            type: 'or',
            filters: [
              { type: 'eq', key: 'team', value: 'core' },
              { type: 'eq', key: 'team', value: 'infra' },
            ],
          },
        ],
      }),
      '(dept = "eng") AND ((team = "core") OR (team = "infra"))',
    )
  })

  it('throws on empty AND/OR sub-filter arrays', () => {
    assert.throws(
      () => filterToGeminiString({ type: 'and', filters: [] }),
      /AND requires at least one sub-filter/,
    )
    assert.throws(
      () => filterToGeminiString({ type: 'or', filters: [] }),
      /OR requires at least one sub-filter/,
    )
  })
})

// ─── mimeTypeFromFilename ────────────────────────────────

describe('mimeTypeFromFilename', () => {
  it('maps common text extensions', () => {
    assert.equal(mimeTypeFromFilename('notes.txt'),    'text/plain')
    assert.equal(mimeTypeFromFilename('README.md'),    'text/markdown')
    assert.equal(mimeTypeFromFilename('index.html'),   'text/html')
    assert.equal(mimeTypeFromFilename('table.csv'),    'text/csv')
  })

  it('maps common document extensions', () => {
    assert.equal(mimeTypeFromFilename('report.pdf'),   'application/pdf')
    assert.equal(mimeTypeFromFilename('memo.docx'),    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert.equal(mimeTypeFromFilename('data.json'),    'application/json')
  })

  it('is case-insensitive on the extension', () => {
    assert.equal(mimeTypeFromFilename('REPORT.PDF'),   'application/pdf')
    assert.equal(mimeTypeFromFilename('Notes.Txt'),    'text/plain')
  })

  it('returns empty string for unknown extensions (defer to SDK error)', () => {
    assert.equal(mimeTypeFromFilename('mystery.xyz'),  '')
    assert.equal(mimeTypeFromFilename('no-extension'), '')
  })
})

// ─── attributesToCustomMetadata / round-trip ─────────────

describe('attributesToCustomMetadata', () => {
  it('emits stringValue for string attrs', () => {
    assert.deepEqual(
      attributesToCustomMetadata({ author: 'Alice' }),
      [{ key: 'author', stringValue: 'Alice' }],
    )
  })

  it('emits numericValue for number attrs', () => {
    assert.deepEqual(
      attributesToCustomMetadata({ year: 2026 }),
      [{ key: 'year', numericValue: 2026 }],
    )
  })

  it('coerces booleans to stringValue "true"/"false"', () => {
    assert.deepEqual(
      attributesToCustomMetadata({ published: true, draft: false }),
      [
        { key: 'published', stringValue: 'true'  },
        { key: 'draft',     stringValue: 'false' },
      ],
    )
  })
})

describe('customMetadataToAttributes', () => {
  it('reads stringValue back as string', () => {
    assert.deepEqual(
      customMetadataToAttributes([{ key: 'author', stringValue: 'Alice' }]),
      { author: 'Alice' },
    )
  })

  it('reads numericValue back as number', () => {
    assert.deepEqual(
      customMetadataToAttributes([{ key: 'year', numericValue: 2026 }]),
      { year: 2026 },
    )
  })

  it('round-trips booleans encoded as "true"/"false"', () => {
    assert.deepEqual(
      customMetadataToAttributes([
        { key: 'published', stringValue: 'true'  },
        { key: 'draft',     stringValue: 'false' },
      ]),
      { published: true, draft: false },
    )
  })

  it('drops stringListValue (no flat representation)', () => {
    assert.deepEqual(
      customMetadataToAttributes([
        { key: 'tags', stringListValue: { values: ['a', 'b'] } },
        { key: 'year', numericValue: 2026 },
      ]),
      { year: 2026 },
    )
  })

  it('round-trips attributesToCustomMetadata for all primitive types', () => {
    const original = { author: 'Alice', year: 2026, published: true }
    const cm       = attributesToCustomMetadata(original)
    const back     = customMetadataToAttributes(cm)
    assert.deepEqual(back, original)
  })
})

// ─── fromGeminiFileSearchStore ───────────────────────────

describe('fromGeminiFileSearchStore', () => {
  it('maps a typical response shape into VectorStoreInfo', () => {
    const info = fromGeminiFileSearchStore({
      name:                  'fileSearchStores/kb-123',
      displayName:           'Knowledge Base',
      createTime:            '2026-05-11T10:00:00Z',
      activeDocumentsCount:  '7',
      pendingDocumentsCount: '2',
      sizeBytes:             '15360',
    })
    assert.equal(info.id,        'fileSearchStores/kb-123')
    assert.equal(info.name,      'Knowledge Base')
    assert.equal(info.fileCount, 9)
    assert.equal(info.bytesUsed, 15360)
    assert.equal(info.createdAt, Math.floor(Date.parse('2026-05-11T10:00:00Z') / 1000))
  })

  it('falls back to displayNameOverride when API omits displayName', () => {
    const info = fromGeminiFileSearchStore(
      { name: 'fileSearchStores/foo' },
      'Knowledge Base',
    )
    assert.equal(info.name, 'Knowledge Base')
  })

  it('falls back to id when neither displayName nor override is present', () => {
    const info = fromGeminiFileSearchStore({ name: 'fileSearchStores/anon' })
    assert.equal(info.name, 'fileSearchStores/anon')
  })

  it('drops bytesUsed when sizeBytes is missing or non-numeric', () => {
    const info1 = fromGeminiFileSearchStore({ name: 'x' })
    assert.equal(info1.bytesUsed, undefined)
    const info2 = fromGeminiFileSearchStore({ name: 'x', sizeBytes: 'not-a-number' })
    assert.equal(info2.bytesUsed, undefined)
  })
})

// ─── fromGeminiDocument ──────────────────────────────────

describe('fromGeminiDocument', () => {
  it('maps STATE_ACTIVE to status: completed', () => {
    const info = fromGeminiDocument(
      { name: 'fileSearchStores/x/documents/y', state: 'STATE_ACTIVE', sizeBytes: '1024', createTime: '2026-05-11T10:00:00Z' },
      'fileSearchStores/x',
    )
    assert.equal(info.id,            'fileSearchStores/x/documents/y')
    assert.equal(info.vectorStoreId, 'fileSearchStores/x')
    assert.equal(info.status,        'completed')
    assert.equal(info.bytes,         1024)
  })

  it('maps STATE_FAILED to status: failed', () => {
    const info = fromGeminiDocument({ name: 'x/documents/y', state: 'STATE_FAILED' }, 'x')
    assert.equal(info.status, 'failed')
  })

  it('maps STATE_PENDING to status: in_progress', () => {
    const info = fromGeminiDocument({ name: 'x/documents/y', state: 'STATE_PENDING' }, 'x')
    assert.equal(info.status, 'in_progress')
  })

  it('maps unknown / STATE_UNSPECIFIED to status: in_progress (conservative)', () => {
    const info = fromGeminiDocument({ name: 'x/documents/y' }, 'x')
    assert.equal(info.status, 'in_progress')
  })

  it('surfaces customMetadata as flat attributes', () => {
    const info = fromGeminiDocument({
      name:           'x/documents/y',
      state:          'STATE_ACTIVE',
      customMetadata: [
        { key: 'author', stringValue: 'Alice' },
        { key: 'year',   numericValue: 2026 },
      ],
    }, 'x')
    assert.deepEqual(info.attributes, { author: 'Alice', year: 2026 })
  })
})

// ─── GoogleVectorStoreAdapter — CRUD ─────────────────────

interface FakeFss {
  client: any
  calls: Array<{ method: string; args: unknown[] }>
  /** Counter for createdAt-derivable ids. */
  next: () => number
}

function makeFakeGoogleClient(overrides: {
  uploadOps?: any[]
  importOps?: any[]
  opGetResponses?: any[]
  documentsGet?: (params: { name: string }) => any
} = {}): FakeFss {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const stores: Record<string, any> = {}
  let n = 1
  const next = () => n++

  let uploadIdx = 0
  let importIdx = 0
  let opGetIdx  = 0

  const client = {
    fileSearchStores: {
      async create(args: { config?: { displayName?: string } }) {
        calls.push({ method: 'fileSearchStores.create', args: [args] })
        const id = `fileSearchStores/kb-${next()}`
        const store = {
          name:                  id,
          displayName:           args.config?.displayName,
          createTime:            '2026-05-11T10:00:00Z',
          activeDocumentsCount:  '0',
          pendingDocumentsCount: '0',
        }
        stores[id] = store
        return store
      },
      async list(args: { config?: Record<string, unknown> }) {
        calls.push({ method: 'fileSearchStores.list', args: [args] })
        return { page: Object.values(stores) }
      },
      async get(args: { name: string }) {
        calls.push({ method: 'fileSearchStores.get', args: [args] })
        return stores[args.name]
      },
      async delete(args: { name: string; config?: { force?: boolean } }) {
        calls.push({ method: 'fileSearchStores.delete', args: [args] })
        delete stores[args.name]
      },
      async uploadToFileSearchStore(args: { fileSearchStoreName: string; file: unknown; config?: Record<string, unknown> }) {
        calls.push({ method: 'fileSearchStores.uploadToFileSearchStore', args: [args] })
        return overrides.uploadOps?.[uploadIdx++] ?? { done: true, response: { documentName: `${args.fileSearchStoreName}/documents/auto-${next()}` } }
      },
      async importFile(args: { fileSearchStoreName: string; fileName: string; config?: Record<string, unknown> }) {
        calls.push({ method: 'fileSearchStores.importFile', args: [args] })
        return overrides.importOps?.[importIdx++] ?? { done: true, response: { documentName: `${args.fileSearchStoreName}/documents/imported-${next()}` } }
      },
      documents: {
        async get(args: { name: string }) {
          calls.push({ method: 'fileSearchStores.documents.get', args: [args] })
          if (overrides.documentsGet) return overrides.documentsGet(args)
          return {
            name:       args.name,
            state:      'STATE_ACTIVE',
            sizeBytes:  '2048',
            createTime: '2026-05-11T10:01:00Z',
          }
        },
        async delete(args: { name: string }) {
          calls.push({ method: 'fileSearchStores.documents.delete', args: [args] })
        },
        async list(args: { parent: string; config?: Record<string, unknown> }) {
          calls.push({ method: 'fileSearchStores.documents.list', args: [args] })
          return { page: [
            { name: `${args.parent}/documents/d1`, state: 'STATE_ACTIVE', sizeBytes: '100', createTime: '2026-05-11T10:00:00Z' },
            { name: `${args.parent}/documents/d2`, state: 'STATE_PENDING' },
          ] }
        },
      },
    },
    operations: {
      async get(args: { operation: any }) {
        calls.push({ method: 'operations.get', args: [args] })
        const next = overrides.opGetResponses?.[opGetIdx++] ?? { ...args.operation, done: true, response: { documentName: 'fileSearchStores/x/documents/y' } }
        return next
      },
    },
  }

  return { client, calls, next }
}

function adapterWith(client: any): VectorStoreAdapter {
  const provider = new GoogleProvider({ apiKey: 'k' })
  const adapter  = provider.createVectorStores()
  ;(adapter as unknown as { getClient: { set(c: unknown): void } }).getClient.set(client)
  return adapter
}

describe('GoogleVectorStoreAdapter — create', () => {
  it('passes displayName through and returns a wrapped VectorStoreInfo', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const info = await adapter.create({ name: 'Knowledge Base' })

    assert.equal(info.name,                              'Knowledge Base')
    assert.equal(info.id.startsWith('fileSearchStores/'), true)
    const args = calls.find(c => c.method === 'fileSearchStores.create')!.args[0] as { config?: { displayName?: string } }
    assert.equal(args.config?.displayName, 'Knowledge Base')
  })

  it('throws if store-level metadata is supplied (unsupported on Gemini)', async () => {
    const { client } = makeFakeGoogleClient()
    const adapter = adapterWith(client)
    await assert.rejects(
      () => adapter.create({ name: 'kb', metadata: { team: 'support' } }),
      /does not support store-level metadata/,
    )
  })

  it('throws if expiresAfter is supplied (unsupported on Gemini)', async () => {
    const { client } = makeFakeGoogleClient()
    const adapter = adapterWith(client)
    await assert.rejects(
      () => adapter.create({ name: 'kb', expiresAfter: { anchor: 'last_active_at', days: 7 } }),
      /does not support expiresAfter/,
    )
  })
})

describe('GoogleVectorStoreAdapter — list/get/delete', () => {
  it('list() reads pager.page and wraps each item', async () => {
    const { client } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    await adapter.create({ name: 'a' })
    await adapter.create({ name: 'b' })
    const result = await adapter.list()
    assert.equal(result.stores.length, 2)
    assert.deepEqual(
      result.stores.map(s => s.name).sort(),
      ['a', 'b'],
    )
  })

  it('get() reads a single store by resource name', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'test' })
    const fetched = await adapter.get(created.id)
    assert.equal(fetched.id, created.id)
    const args = calls.filter(c => c.method === 'fileSearchStores.get').at(-1)!.args[0] as { name: string }
    assert.equal(args.name, created.id)
  })

  it('delete() forwards force: true to the SDK', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'test' })
    await adapter.delete(created.id)

    const args = calls.find(c => c.method === 'fileSearchStores.delete')!.args[0] as { name: string; config?: { force?: boolean } }
    assert.equal(args.name,          created.id)
    assert.equal(args.config?.force, true)
  })
})

describe('GoogleVectorStoreAdapter — addFile (importFile path)', () => {
  it('routes a preexisting Files API id through importFile', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    const file    = await adapter.addFile(created.id, { fileId: 'files/abc-123' })

    const importCall = calls.find(c => c.method === 'fileSearchStores.importFile')!
    const args = importCall.args[0] as { fileSearchStoreName: string; fileName: string }
    assert.equal(args.fileSearchStoreName, created.id)
    assert.equal(args.fileName,            'files/abc-123')
    assert.equal(file.status,              'completed')
    assert.equal(file.vectorStoreId,       created.id)
    // documents.get is called after the LRO completes to surface size/state.
    assert.ok(calls.find(c => c.method === 'fileSearchStores.documents.get'))
  })

  it('forwards attributes as customMetadata', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await adapter.addFile(created.id, {
      fileId:     'files/abc-123',
      attributes: { author: 'Alice', year: 2026 },
    })

    const importCall = calls.find(c => c.method === 'fileSearchStores.importFile')!
    const args = importCall.args[0] as { config?: { customMetadata?: unknown } }
    assert.deepEqual(args.config?.customMetadata, [
      { key: 'author', stringValue:  'Alice' },
      { key: 'year',   numericValue: 2026    },
    ])
  })
})

describe('GoogleVectorStoreAdapter — addFile (upload path)', () => {
  it('routes filePath through uploadToFileSearchStore', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await adapter.addFile(created.id, { filePath: '/tmp/test.pdf' })

    const upload = calls.find(c => c.method === 'fileSearchStores.uploadToFileSearchStore')!
    const args = upload.args[0] as { fileSearchStoreName: string; file: string }
    assert.equal(args.fileSearchStoreName, created.id)
    assert.equal(args.file,                '/tmp/test.pdf')
  })

  it('routes fileBuffer through Blob + uploadToFileSearchStore (with displayName + mimeType)', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await adapter.addFile(created.id, {
      fileBuffer: { data: new Uint8Array([1, 2, 3]), filename: 'report.pdf' },
    })

    const upload = calls.find(c => c.method === 'fileSearchStores.uploadToFileSearchStore')!
    const args = upload.args[0] as { fileSearchStoreName: string; file: Blob; config?: { displayName?: string; mimeType?: string } }
    assert.ok(args.file instanceof Blob)
    assert.equal(args.config?.displayName, 'report.pdf')
    // mimeType is required by the Gemini SDK for Blob uploads — the adapter
    // must derive it from the filename to avoid 'Can not determine mimeType'.
    assert.equal(args.config?.mimeType,    'application/pdf')
  })

  it('omits mimeType when filename extension is unknown (defer to SDK error)', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await adapter.addFile(created.id, {
      fileBuffer: { data: new Uint8Array([1, 2, 3]), filename: 'mystery.xyz' },
    })

    const upload = calls.find(c => c.method === 'fileSearchStores.uploadToFileSearchStore')!
    const args = upload.args[0] as { config?: { mimeType?: string } }
    assert.equal('mimeType' in (args.config ?? {}), false)
  })

  it('does not set mimeType on the filePath upload path (SDK infers from extension)', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await adapter.addFile(created.id, { filePath: '/tmp/test.pdf' })

    const upload = calls.find(c => c.method === 'fileSearchStores.uploadToFileSearchStore')!
    const args = upload.args[0] as { config?: { mimeType?: string } }
    assert.equal('mimeType' in (args.config ?? {}), false)
  })

  it('throws when neither fileId, filePath, nor fileBuffer is passed', async () => {
    const { client } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const created = await adapter.create({ name: 'kb' })
    await assert.rejects(
      () => adapter.addFile(created.id, {}),
      /requires fileId, filePath, or fileBuffer/,
    )
  })

  it('polls operations.get until done when the initial op is not finished', async () => {
    const { client, calls } = makeFakeGoogleClient({
      uploadOps: [
        // First response: not done. Triggers polling.
        { name: 'operations/abc', done: false },
      ],
      opGetResponses: [
        { name: 'operations/abc', done: false },
        { name: 'operations/abc', done: true,  response: { documentName: 'fileSearchStores/kb-1/documents/auto' } },
      ],
    })
    const adapter = adapterWith(client)
    const created = await adapter.create({ name: 'kb' })

    const file = await adapter.addFile(created.id, {
      filePath:     '/tmp/test.pdf',
      pollInterval: 1,
      pollTimeout:  1000,
    })

    assert.equal(file.status, 'completed')
    const polls = calls.filter(c => c.method === 'operations.get')
    assert.equal(polls.length >= 2, true, 'expected at least 2 poll cycles')
  })

  it('surfaces operation errors as status: failed without throwing', async () => {
    const { client } = makeFakeGoogleClient({
      uploadOps: [{
        name:  'operations/err',
        done:  true,
        error: { code: 3, message: 'unsupported file type' },
      }],
    })
    const adapter = adapterWith(client)
    const created = await adapter.create({ name: 'kb' })

    const file = await adapter.addFile(created.id, { filePath: '/tmp/bad.exe', pollInterval: 1, pollTimeout: 100 })

    assert.equal(file.status,    'failed')
    assert.equal(file.lastError, 'unsupported file type')
  })

  it('returns in_progress immediately when wait: false (fire-and-forget)', async () => {
    const { client, calls } = makeFakeGoogleClient({
      uploadOps: [{ name: 'operations/pending', done: false }],
    })
    const adapter = adapterWith(client)
    const created = await adapter.create({ name: 'kb' })

    const file = await adapter.addFile(created.id, { filePath: '/tmp/large.pdf', wait: false })

    assert.equal(file.status, 'in_progress')
    const polls = calls.filter(c => c.method === 'operations.get')
    assert.equal(polls.length, 0, 'expected no polls when wait: false')
  })

  it('throws when polling exceeds timeout', async () => {
    const { client } = makeFakeGoogleClient({
      uploadOps:      [{ name: 'operations/slow', done: false }],
      opGetResponses: [
        { name: 'operations/slow', done: false },
        { name: 'operations/slow', done: false },
        { name: 'operations/slow', done: false },
      ],
    })
    const adapter = adapterWith(client)
    const created = await adapter.create({ name: 'kb' })
    await assert.rejects(
      () => adapter.addFile(created.id, { filePath: '/tmp/x', pollInterval: 5, pollTimeout: 12 }),
      /timed out/,
    )
  })
})

describe('GoogleVectorStoreAdapter — removeFile / listFiles', () => {
  it('removeFile() joins the document path when caller passes a bare id', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    await adapter.removeFile('fileSearchStores/kb-1', 'doc-abc')
    const args = calls.find(c => c.method === 'fileSearchStores.documents.delete')!.args[0] as { name: string }
    assert.equal(args.name, 'fileSearchStores/kb-1/documents/doc-abc')
  })

  it('removeFile() passes a full document path verbatim', async () => {
    const { client, calls } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    await adapter.removeFile('fileSearchStores/kb-1', 'fileSearchStores/kb-1/documents/full-path')
    const args = calls.find(c => c.method === 'fileSearchStores.documents.delete')!.args[0] as { name: string }
    assert.equal(args.name, 'fileSearchStores/kb-1/documents/full-path')
  })

  it('listFiles() reads documents.list and maps statuses', async () => {
    const { client } = makeFakeGoogleClient()
    const adapter = adapterWith(client)

    const result = await adapter.listFiles('fileSearchStores/kb-1')
    assert.equal(result.files.length, 2)
    assert.equal(result.files[0]!.status, 'completed')
    assert.equal(result.files[1]!.status, 'in_progress')
  })
})

// ─── toGeminiTools — providerHint: 'file-search' ─────────

describe('toGeminiTools — file-search providerHint', () => {
  it('emits the native fileSearch block with fileSearchStoreNames', async () => {
    const tool   = fileSearch({ stores: ['fileSearchStores/kb-1'] })
    const blocks = await emitToolBlock(toolToSchema(tool))
    const fs     = blocks.find(b => (b as Record<string, unknown>)['fileSearch']) as { fileSearch: Record<string, unknown> }
    assert.ok(fs, 'expected a fileSearch block')
    assert.deepEqual(fs.fileSearch['fileSearchStoreNames'], ['fileSearchStores/kb-1'])
  })

  it('forwards maxResults as topK', async () => {
    const tool   = fileSearch({ stores: ['fileSearchStores/kb-1'], maxResults: 8 })
    const blocks = await emitToolBlock(toolToSchema(tool))
    const fs     = blocks.find(b => (b as Record<string, unknown>)['fileSearch']) as { fileSearch: Record<string, unknown> }
    assert.equal(fs.fileSearch['topK'], 8)
  })

  it('translates typed where → metadataFilter string', async () => {
    const tool = fileSearch({
      stores: ['fileSearchStores/kb-1'],
      where:  { author: 'Alice', year: 2026 },
    })
    const blocks = await emitToolBlock(toolToSchema(tool))
    const fs = blocks.find(b => (b as Record<string, unknown>)['fileSearch']) as { fileSearch: Record<string, unknown> }
    assert.equal(
      fs.fileSearch['metadataFilter'],
      '(author = "Alice") AND (year = 2026)',
    )
  })

  it('omits metadataFilter and topK when unspecified', async () => {
    const tool = fileSearch({ stores: ['fileSearchStores/kb-1'] })
    const blocks = await emitToolBlock(toolToSchema(tool))
    const fs = blocks.find(b => (b as Record<string, unknown>)['fileSearch']) as { fileSearch: Record<string, unknown> }
    assert.equal('metadataFilter' in fs.fileSearch, false)
    assert.equal('topK'           in fs.fileSearch, false)
  })

  it('falls back to functionDeclarations for non-hinted tools', async () => {
    const blocks = await emitToolBlock({
      name:        'get_weather',
      description: 'fetch the current weather',
      parameters:  { type: 'object', properties: { city: { type: 'string' } } },
    })
    const fnEntry = blocks.find(b => (b as Record<string, unknown>)['functionDeclarations']) as { functionDeclarations: unknown[] }
    assert.ok(fnEntry, 'expected functionDeclarations block')
    assert.equal(fnEntry.functionDeclarations.length, 1)
  })
})
