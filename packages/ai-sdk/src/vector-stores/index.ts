/**
 * `VectorStores` — manage hosted vector stores on the registered AI
 * provider (#B8 Phase 1).
 *
 * Today only OpenAI implements `createVectorStores()` on its provider
 * factory; calls against other providers throw a helpful error pointing
 * users at `similaritySearch()` over a local pgvector model.
 *
 * @example
 * ```ts
 * import { VectorStores } from '@gemstack/ai-sdk'
 *
 * const store = await VectorStores.create('Knowledge Base')
 * await store.add({ filePath: './report.pdf', attributes: { author: 'Alice' } })
 *
 * const all = await VectorStores.list()
 * await VectorStores.delete(store.id)
 * ```
 *
 * Provider override per-call via `opts.provider`. The default falls
 * back to the registered AI default (first entry in the registry, or
 * `AiRegistry.getDefault()`'s provider name).
 *
 * Phase 2 of B8 adds the `fileSearch({ stores })` agent tool that
 * consumes these stores. Phase 3 wires the local pgvector fallback.
 */

import { AiRegistry } from '../registry.js'
import type {
  VectorStoreCreateOptions,
  VectorStoreListOptions,
  VectorStoreInfo,
  VectorStoreFileInfo,
  VectorStoreAddOptions,
} from '../types.js'

/**
 * Wrapper around a single hosted vector store. Holds the provider name
 * + store id so per-store operations don't need to repeat them.
 */
export class VectorStore {
  readonly id:        string
  readonly name:      string
  readonly createdAt: number
  readonly fileCount: number
  readonly bytesUsed: number | undefined
  readonly metadata:  Record<string, string> | undefined
  /** Provider that owns this store (e.g. `'openai'`). */
  readonly provider:  string

  constructor(info: VectorStoreInfo, provider: string) {
    this.id        = info.id
    this.name      = info.name
    this.createdAt = info.createdAt
    this.fileCount = info.fileCount
    this.bytesUsed = info.bytesUsed
    this.metadata  = info.metadata
    this.provider  = provider
  }

  /**
   * Attach a file to this store. Either pass an existing provider
   * `fileId` or a local source (`filePath` or `fileBuffer`) — the
   * adapter uploads via the Files API first and reuses the returned id.
   *
   * Defaults to waiting until the file is fully indexed
   * (`status === 'completed'`). Pass `wait: false` for fire-and-forget.
   */
  async add(opts: VectorStoreAddOptions): Promise<VectorStoreFileInfo> {
    const adapter = AiRegistry.resolveVectorStores(this.provider)
    return adapter.addFile(this.id, opts)
  }

  /** Remove a file from this store. The file remains in the provider's
   *  Files API (use `AI.files(provider).delete(id)` to fully delete). */
  async remove(fileId: string): Promise<void> {
    const adapter = AiRegistry.resolveVectorStores(this.provider)
    await adapter.removeFile(this.id, fileId)
  }

  /** List all files attached to this store. */
  async files(opts?: VectorStoreListOptions): Promise<VectorStoreFileInfo[]> {
    const adapter = AiRegistry.resolveVectorStores(this.provider)
    const result  = await adapter.listFiles(this.id, opts)
    return result.files
  }

  /** Delete this store. Files attached to it stay in the provider's
   *  Files API; call `AI.files(provider).delete(id)` to clean those up
   *  separately. */
  async delete(): Promise<void> {
    const adapter = AiRegistry.resolveVectorStores(this.provider)
    await adapter.delete(this.id)
  }
}

/**
 * Static facade for hosted-vector-store CRUD across all providers
 * implementing `createVectorStores()`.
 */
export class VectorStores {
  /**
   * Create a new vector store on the registered (or specified)
   * provider.
   */
  static async create(name: string, opts: Omit<VectorStoreCreateOptions, 'name'> = {}): Promise<VectorStore> {
    const provider = resolveProvider(opts.provider)
    const adapter  = AiRegistry.resolveVectorStores(provider)
    const createOpts: VectorStoreCreateOptions = { name }
    if (opts.metadata)     createOpts.metadata     = opts.metadata
    if (opts.expiresAfter) createOpts.expiresAfter = opts.expiresAfter
    const info = await adapter.create(createOpts)
    return new VectorStore(info, provider)
  }

  /**
   * List vector stores on the registered (or specified) provider.
   *
   * `opts.limit` / `opts.after` / `opts.before` map directly to the
   * provider's pagination cursor — apps wanting a complete list need to
   * iterate manually.
   */
  static async list(opts: VectorStoreListOptions & { provider?: string } = {}): Promise<VectorStore[]> {
    const provider = resolveProvider(opts.provider)
    const adapter  = AiRegistry.resolveVectorStores(provider)
    const listOpts: VectorStoreListOptions = {}
    if (opts.limit  !== undefined) listOpts.limit  = opts.limit
    if (opts.after  !== undefined) listOpts.after  = opts.after
    if (opts.before !== undefined) listOpts.before = opts.before
    const result = await adapter.list(listOpts)
    return result.stores.map(info => new VectorStore(info, provider))
  }

  /**
   * Fetch a vector store by id. Throws when not found (provider-specific
   * error surface — typically a 404).
   */
  static async get(id: string, opts: { provider?: string } = {}): Promise<VectorStore> {
    const provider = resolveProvider(opts.provider)
    const adapter  = AiRegistry.resolveVectorStores(provider)
    const info     = await adapter.get(id)
    return new VectorStore(info, provider)
  }

  /**
   * Delete a vector store by id. Files attached to it stay in the
   * provider's Files API.
   */
  static async delete(id: string, opts: { provider?: string } = {}): Promise<void> {
    const provider = resolveProvider(opts.provider)
    const adapter  = AiRegistry.resolveVectorStores(provider)
    await adapter.delete(id)
  }
}

/**
 * Resolve the provider name to dispatch to. Explicit `opts.provider`
 * wins; otherwise we read the registered AI default and extract the
 * provider segment (`'openai/text-embedding-3-small'` → `'openai'`).
 */
function resolveProvider(explicit: string | undefined): string {
  if (explicit) return explicit
  const def = AiRegistry.getDefault()
  return AiRegistry.parseModelString(def)[0]
}
