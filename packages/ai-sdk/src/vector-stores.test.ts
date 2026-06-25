import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { AiRegistry } from './registry.js'
import { VectorStores, VectorStore } from './vector-stores/index.js'
import type {
  ProviderAdapter,
  ProviderFactory,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  VectorStoreAdapter,
} from './types.js'

// ─── Fake OpenAI vector-store backend ─────────────────────

interface CapturedCall { method: string; args: unknown[] }

interface FakeBackendOptions {
  /** Sequence of responses for `vectorStores.files.retrieve` polls — first
   *  call returns entries[0], second returns entries[1], etc. Falls back to
   *  the last entry once the sequence is exhausted. */
  pollSequence?: Array<{ status: string; usage_bytes?: number; last_error?: { message: string } }>
}

function makeFakeOpenAi(opts: FakeBackendOptions = {}) {
  const calls: CapturedCall[] = []
  const stores: Record<string, { id: string; name: string; created_at: number; metadata?: Record<string, string>; file_counts: { total: number } }> = {}
  let nextId = 1
  let pollIdx = 0

  const fileBatchesCreate = async (storeId: string, args: { file_id: string; attributes?: unknown }) => {
    calls.push({ method: 'vectorStores.files.create', args: [storeId, args] })
    const initial = opts.pollSequence?.[0] ?? { status: 'completed' }
    pollIdx = 1
    return {
      id:         args.file_id,
      created_at: Math.floor(Date.now() / 1000),
      status:     initial.status,
      ...(initial.usage_bytes !== undefined ? { usage_bytes: initial.usage_bytes } : {}),
      ...(args.attributes ? { attributes: args.attributes } : {}),
      ...(initial.last_error ? { last_error: initial.last_error } : {}),
    }
  }

  const filesRetrieve = async (storeId: string, fileId: string) => {
    calls.push({ method: 'vectorStores.files.retrieve', args: [storeId, fileId] })
    const entry = opts.pollSequence?.[pollIdx] ?? opts.pollSequence?.[(opts.pollSequence?.length ?? 1) - 1] ?? { status: 'completed' }
    pollIdx++
    return {
      id:         fileId,
      created_at: Math.floor(Date.now() / 1000),
      status:     entry.status,
      ...(entry.usage_bytes !== undefined ? { usage_bytes: entry.usage_bytes } : {}),
      ...(entry.last_error ? { last_error: entry.last_error } : {}),
    }
  }

  const fakeClient = {
    vectorStores: {
      create: async (args: { name: string; metadata?: Record<string, string>; expires_after?: unknown }) => {
        calls.push({ method: 'vectorStores.create', args: [args] })
        const id = `vs_${nextId++}`
        const store = {
          id, name: args.name,
          created_at: Math.floor(Date.now() / 1000),
          file_counts: { total: 0 },
          ...(args.metadata ? { metadata: args.metadata } : {}),
        }
        stores[id] = store
        return store
      },
      list: async (args: { limit?: number } = {}) => {
        calls.push({ method: 'vectorStores.list', args: [args] })
        return { data: Object.values(stores) }
      },
      retrieve: async (id: string) => {
        calls.push({ method: 'vectorStores.retrieve', args: [id] })
        return stores[id] ?? null
      },
      del: async (id: string) => {
        calls.push({ method: 'vectorStores.del', args: [id] })
        delete stores[id]
        return { id, deleted: true }
      },
      files: {
        create:   fileBatchesCreate,
        retrieve: filesRetrieve,
        del: async (storeId: string, fileId: string) => {
          calls.push({ method: 'vectorStores.files.del', args: [storeId, fileId] })
          return { id: fileId, deleted: true }
        },
        list: async (storeId: string, args: unknown) => {
          calls.push({ method: 'vectorStores.files.list', args: [storeId, args] })
          return { data: [
            { id: 'file_1', created_at: 1000, status: 'completed' },
            { id: 'file_2', created_at: 1001, status: 'in_progress' },
          ] }
        },
      },
    },
    files: {
      create: async (args: { purpose: string }) => {
        calls.push({ method: 'files.create', args: [args] })
        return { id: `file_uploaded_${nextId++}`, filename: 'test.pdf', bytes: 1024, purpose: args.purpose }
      },
    },
  }

  return { fakeClient, calls }
}

/**
 * Register a fake `__fake_openai__` provider whose vector-store adapter
 * is wired through the captured client. Mirrors how `AiFake` registers
 * itself. We don't use `AiFake.fake()` directly because it doesn't yet
 * expose vector-store hooks — Phase 1 ships the adapter, AiFake catches
 * up in Phase 2 alongside `fileSearch`.
 */
function registerFakeProvider(client: unknown): void {
  const noopAdapter: ProviderAdapter = {
    async generate(_opts: ProviderRequestOptions): Promise<ProviderResponse> {
      throw new Error('fake provider does not support generate in vector-stores tests')
    },
    // `yield*` over an empty iterable satisfies eslint's `require-yield`
    // (a generator needs a yield syntactically) without a constant-false
    // condition; it yields nothing, so the throw below is the real behavior.
    async *stream(_opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      yield* [] as StreamChunk[]
      throw new Error('fake provider does not support stream in vector-stores tests')
    },
  }

  const factory: ProviderFactory = {
    name: '__fake_openai__',
    create: () => noopAdapter,
    createVectorStores: () => makeAdapter(client),
  }
  AiRegistry.reset()
  AiRegistry.register(factory)
  AiRegistry.setDefault('__fake_openai__/default')
}

/**
 * Build a real `OpenAIVectorStoreAdapter`-shape wrapper around our
 * fake client. We can't import the class directly (it's not exported),
 * so we re-implement the same SDK shape — this also catches drift if
 * the real adapter changes its SDK call patterns.
 */
function makeAdapter(client: unknown): VectorStoreAdapter {
  const c = client as {
    vectorStores: {
      create:   (args: unknown) => Promise<unknown>
      list:     (args: unknown) => Promise<{ data: unknown[] }>
      retrieve: (id: string)    => Promise<unknown>
      del:      (id: string)    => Promise<unknown>
      files: {
        create:   (storeId: string, args: unknown) => Promise<unknown>
        retrieve: (storeId: string, fileId: string) => Promise<unknown>
        del:      (storeId: string, fileId: string) => Promise<unknown>
        list:     (storeId: string, args: unknown) => Promise<{ data: unknown[] }>
      }
    }
    files: { create: (args: unknown) => Promise<{ id: string }> }
  }

  function mapStore(raw: unknown) {
    const r = raw as { id: string; name: string; created_at: number; file_counts?: { total?: number }; usage_bytes?: number; metadata?: Record<string, string> }
    const result = {
      id:        r.id,
      name:      r.name,
      createdAt: r.created_at,
      fileCount: r.file_counts?.total ?? 0,
    } as { id: string; name: string; createdAt: number; fileCount: number; bytesUsed?: number; metadata?: Record<string, string> }
    if (r.usage_bytes !== undefined) result.bytesUsed = r.usage_bytes
    if (r.metadata    !== undefined) result.metadata  = r.metadata
    return result
  }

  function mapFile(raw: unknown, storeId: string) {
    const r = raw as { id: string; created_at: number; status: string; usage_bytes?: number; attributes?: Record<string, string | number | boolean>; last_error?: { message: string } }
    const result = {
      id: r.id,
      vectorStoreId: storeId,
      status: r.status as 'in_progress' | 'completed' | 'failed' | 'cancelled',
      createdAt: r.created_at,
    } as { id: string; vectorStoreId: string; status: 'in_progress' | 'completed' | 'failed' | 'cancelled'; createdAt: number; bytes?: number; attributes?: Record<string, string | number | boolean>; lastError?: string }
    if (r.usage_bytes !== undefined)         result.bytes      = r.usage_bytes
    if (r.attributes  !== undefined)         result.attributes = r.attributes
    if (r.last_error?.message !== undefined) result.lastError  = r.last_error.message
    return result
  }

  return {
    async create(opts) {
      const params: Record<string, unknown> = { name: opts.name }
      if (opts.metadata)     params['metadata']      = opts.metadata
      if (opts.expiresAfter) params['expires_after'] = opts.expiresAfter
      return mapStore(await c.vectorStores.create(params))
    },
    async list(opts) {
      const r = await c.vectorStores.list(opts ?? {})
      return { stores: r.data.map(mapStore) }
    },
    async get(id) { return mapStore(await c.vectorStores.retrieve(id)) },
    async delete(id) { await c.vectorStores.del(id) },
    async addFile(storeId, opts) {
      let fileId = opts.fileId
      if (!fileId) {
        if (!opts.filePath && !opts.fileBuffer) {
          throw new Error('addFile requires fileId, filePath, or fileBuffer')
        }
        const uploaded = await c.files.create({ purpose: 'assistants' })
        fileId = uploaded.id
      }
      const attachParams: Record<string, unknown> = { file_id: fileId }
      if (opts.attributes)       attachParams['attributes']        = opts.attributes
      if (opts.chunkingStrategy) attachParams['chunking_strategy'] = opts.chunkingStrategy
      const attached = await c.vectorStores.files.create(storeId, attachParams)

      if (opts.wait === false) return mapFile(attached, storeId)

      const interval = opts.pollInterval ?? 1
      const timeout  = opts.pollTimeout  ?? 100
      const deadline = Date.now() + timeout
      let current: unknown = attached
      while (true) {
        const info = mapFile(current, storeId)
        if (info.status === 'completed' || info.status === 'failed' || info.status === 'cancelled') return info
        if (Date.now() > deadline) {
          throw new Error(`vector-store file ingestion timed out after ${timeout}ms (status=${info.status})`)
        }
        await new Promise(r => setTimeout(r, interval))
        current = await c.vectorStores.files.retrieve(storeId, fileId)
      }
    },
    async removeFile(storeId, fileId) { await c.vectorStores.files.del(storeId, fileId) },
    async listFiles(storeId, opts) {
      const r = await c.vectorStores.files.list(storeId, opts ?? {})
      return { files: r.data.map(d => mapFile(d, storeId)) }
    },
  }
}

// ─── Tests ────────────────────────────────────────────────

describe('VectorStores — provider resolution', () => {
  beforeEach(() => { AiRegistry.reset() })
  afterEach(() => { AiRegistry.reset() })

  it('throws a helpful error when the resolved provider has no createVectorStores', async () => {
    AiRegistry.register({
      name: 'no_vector',
      create: () => ({} as unknown as ProviderAdapter),
    })
    AiRegistry.setDefault('no_vector/default')

    await assert.rejects(
      () => VectorStores.create('test'),
      /does not support hosted vector stores/i,
    )
  })

  it('honors an explicit provider override', async () => {
    const { fakeClient } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)
    AiRegistry.register({
      name: 'no_vector',
      create: () => ({} as unknown as ProviderAdapter),
    })
    AiRegistry.setDefault('no_vector/default')

    const store = await VectorStores.create('test', { provider: '__fake_openai__' })
    assert.equal(store.provider, '__fake_openai__')
  })
})

describe('VectorStores — create()', () => {
  beforeEach(() => { AiRegistry.reset() })
  afterEach(() => { AiRegistry.reset() })

  it('returns a VectorStore wrapping the provider response', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('Knowledge Base')

    assert.ok(store instanceof VectorStore)
    assert.equal(store.name, 'Knowledge Base')
    assert.equal(store.id.startsWith('vs_'), true)
    assert.equal(store.provider, '__fake_openai__')

    const create = calls.find(c => c.method === 'vectorStores.create')
    assert.deepEqual((create!.args[0] as { name: string }).name, 'Knowledge Base')
  })

  it('forwards metadata + expiresAfter to the provider', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    await VectorStores.create('Docs', {
      metadata:     { team: 'support' },
      expiresAfter: { anchor: 'last_active_at', days: 7 },
    })

    const args = calls.find(c => c.method === 'vectorStores.create')!.args[0] as Record<string, unknown>
    assert.deepEqual(args['metadata'],      { team: 'support' })
    assert.deepEqual(args['expires_after'], { anchor: 'last_active_at', days: 7 })
  })
})

describe('VectorStores — list/get/delete', () => {
  beforeEach(() => { AiRegistry.reset() })
  afterEach(() => { AiRegistry.reset() })

  it('list() returns wrapped VectorStore instances', async () => {
    const { fakeClient } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    await VectorStores.create('a')
    await VectorStores.create('b')
    const all = await VectorStores.list()
    assert.equal(all.length, 2)
    for (const s of all) assert.ok(s instanceof VectorStore)
  })

  it('get() retrieves a store by id', async () => {
    const { fakeClient } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const created = await VectorStores.create('test')
    const fetched = await VectorStores.get(created.id)
    assert.equal(fetched.id,   created.id)
    assert.equal(fetched.name, 'test')
  })

  it('delete() routes through the provider', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await VectorStores.delete(store.id)

    const del = calls.find(c => c.method === 'vectorStores.del')
    assert.deepEqual(del!.args, [store.id])
  })
})

describe('VectorStore — add()', () => {
  beforeEach(() => { AiRegistry.reset() })
  afterEach(() => { AiRegistry.reset() })

  it('attaches an existing file id and polls until completed (default wait: true)', async () => {
    const { fakeClient, calls } = makeFakeOpenAi({
      pollSequence: [
        { status: 'in_progress' },
        { status: 'in_progress' },
        { status: 'completed', usage_bytes: 2048 },
      ],
    })
    registerFakeProvider(fakeClient)

    const store  = await VectorStores.create('test')
    const result = await store.add({ fileId: 'file_existing', pollInterval: 1, pollTimeout: 1000 })

    assert.equal(result.status,        'completed')
    assert.equal(result.bytes,         2048)
    assert.equal(result.vectorStoreId, store.id)

    const polls = calls.filter(c => c.method === 'vectorStores.files.retrieve')
    assert.equal(polls.length >= 2, true, 'expected at least 2 retrieve polls')
  })

  it('uploads via Files API when filePath is provided (no preexisting fileId)', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await store.add({ filePath: '/tmp/test.pdf', pollInterval: 1, pollTimeout: 1000 })

    const upload = calls.find(c => c.method === 'files.create')
    assert.ok(upload, 'expected files.create to be invoked')
    assert.deepEqual((upload.args[0] as { purpose: string }).purpose, 'assistants')

    const attach = calls.find(c => c.method === 'vectorStores.files.create')
    assert.ok(attach, 'expected vectorStores.files.create to be invoked')
    const attachArgs = attach.args[1] as { file_id: string }
    assert.equal(attachArgs.file_id.startsWith('file_uploaded_'), true)
  })

  it('forwards attributes for searchable metadata', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await store.add({ fileId: 'file_x', attributes: { author: 'Alice', year: 2026 }, pollInterval: 1 })

    const attach = calls.find(c => c.method === 'vectorStores.files.create')!
    const attrs  = (attach.args[1] as { attributes?: Record<string, unknown> }).attributes
    assert.deepEqual(attrs, { author: 'Alice', year: 2026 })
  })

  it('skips polling when wait: false (fire-and-forget)', async () => {
    const { fakeClient, calls } = makeFakeOpenAi({ pollSequence: [{ status: 'in_progress' }] })
    registerFakeProvider(fakeClient)

    const store  = await VectorStores.create('test')
    const result = await store.add({ fileId: 'file_x', wait: false })

    assert.equal(result.status, 'in_progress')
    const polls = calls.filter(c => c.method === 'vectorStores.files.retrieve')
    assert.equal(polls.length, 0, 'expected no polls when wait: false')
  })

  it('throws when polling exceeds the timeout budget', async () => {
    const { fakeClient } = makeFakeOpenAi({ pollSequence: [{ status: 'in_progress' }, { status: 'in_progress' }, { status: 'in_progress' }] })
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await assert.rejects(
      () => store.add({ fileId: 'file_x', pollInterval: 5, pollTimeout: 12 }),
      /timed out/i,
    )
  })

  it('surfaces failed status without throwing', async () => {
    const { fakeClient } = makeFakeOpenAi({ pollSequence: [{ status: 'failed', last_error: { message: 'unsupported file type' } }] })
    registerFakeProvider(fakeClient)

    const store  = await VectorStores.create('test')
    const result = await store.add({ fileId: 'file_x', pollInterval: 1, pollTimeout: 1000 })

    assert.equal(result.status,    'failed')
    assert.equal(result.lastError, 'unsupported file type')
  })

  it('throws when neither fileId, filePath, nor fileBuffer is passed', async () => {
    const { fakeClient } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await assert.rejects(
      () => store.add({}),
      /requires fileId/i,
    )
  })
})

describe('VectorStore — remove() / files() / delete()', () => {
  beforeEach(() => { AiRegistry.reset() })
  afterEach(() => { AiRegistry.reset() })

  it('remove() deletes a single file from the store', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await store.remove('file_x')

    const del = calls.find(c => c.method === 'vectorStores.files.del')!
    assert.deepEqual(del.args, [store.id, 'file_x'])
  })

  it('files() returns the file list mapped to typed shape', async () => {
    const { fakeClient } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    const files = await store.files()
    assert.equal(files.length, 2)
    assert.equal(files[0]!.id,            'file_1')
    assert.equal(files[0]!.status,        'completed')
    assert.equal(files[0]!.vectorStoreId, store.id)
    assert.equal(files[1]!.status,        'in_progress')
  })

  it('delete() routes through the provider', async () => {
    const { fakeClient, calls } = makeFakeOpenAi()
    registerFakeProvider(fakeClient)

    const store = await VectorStores.create('test')
    await store.delete()

    const del = calls.find(c => c.method === 'vectorStores.del')
    assert.deepEqual(del!.args, [store.id])
  })
})
