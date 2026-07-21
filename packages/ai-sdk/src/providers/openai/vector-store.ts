import type {
  VectorStoreAdapter,
  VectorStoreCreateOptions,
  VectorStoreInfo,
  VectorStoreFileInfo,
  VectorStoreAddOptions,
  VectorStoreListOptions,
  VectorStoreList,
  VectorStoreFileList,
} from '../../types.js'
import { sleep } from '../../util/sleep.js'
import type { OpenAIConfig } from './config.js'

// ─── OpenAI Vector Stores (#B8 Phase 1) ──────────────────

/**
 * OpenAI hosted vector store adapter. Wraps `client.vectorStores.*` and
 * `client.vectorStores.files.*` from the v4+ SDK. Lazy SDK load mirrors
 * the rest of the OpenAI provider.
 *
 * `addFile` defaults to polling until the file is fully indexed
 * (`status === 'completed'`). Pass `{ wait: false }` to fire-and-forget.
 *
 * Local file paths route through OpenAI's Files API first
 * (`client.files.create({ purpose: 'assistants' })`); the resulting
 * `file_id` then attaches to the vector store. Apps that already have
 * a file id pass `{ fileId }` directly.
 */
export class OpenAIVectorStoreAdapter implements VectorStoreAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async create(opts: VectorStoreCreateOptions): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const params: Record<string, unknown> = { name: opts.name }
    if (opts.metadata)     params['metadata']      = opts.metadata
    if (opts.expiresAfter) params['expires_after'] = opts.expiresAfter
    const response = await client.vectorStores.create(params)
    return fromOpenAIVectorStore(response)
  }

  async list(opts?: VectorStoreListOptions): Promise<VectorStoreList> {
    const client = await this.getClient()
    const params: Record<string, unknown> = {}
    if (opts?.limit  !== undefined) params['limit']  = opts.limit
    if (opts?.after  !== undefined) params['after']  = opts.after
    if (opts?.before !== undefined) params['before'] = opts.before
    const response = await client.vectorStores.list(params)
    const data = (response.data ?? []) as unknown[]
    return { stores: data.map(d => fromOpenAIVectorStore(d)) }
  }

  async get(id: string): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const response = await client.vectorStores.retrieve(id)
    return fromOpenAIVectorStore(response)
  }

  async delete(id: string): Promise<void> {
    const client = await this.getClient()
    await client.vectorStores.del(id)
  }

  async addFile(storeId: string, opts: VectorStoreAddOptions): Promise<VectorStoreFileInfo> {
    const client = await this.getClient()

    // Step 1: resolve the file id. If the user passed an existing one we
    // skip the upload; otherwise upload via the standard Files API and
    // reuse the resulting id.
    const fileId = opts.fileId ?? await this.uploadAndGetId(client, opts)

    // Step 2: attach to the store. OpenAI splits attribute + chunking
    // config from the file payload so we pass them as a sibling object.
    const attachParams: Record<string, unknown> = { file_id: fileId }
    if (opts.attributes)        attachParams['attributes']        = opts.attributes
    if (opts.chunkingStrategy)  attachParams['chunking_strategy'] = opts.chunkingStrategy
    const attached = await client.vectorStores.files.create(storeId, attachParams)

    if (opts.wait === false) {
      return fromOpenAIVectorStoreFile(attached, storeId)
    }

    // Step 3: poll until `completed` / `failed` / timeout. Default 2-min
    // budget — enough for typical PDFs but small enough that runaway
    // batch uploads surface a clear error fast.
    const pollInterval = opts.pollInterval ?? 1000
    const pollTimeout  = opts.pollTimeout  ?? 120_000
    const deadline     = Date.now() + pollTimeout

    let current: unknown = attached
    while (true) {
      const info = fromOpenAIVectorStoreFile(current, storeId)
      if (info.status === 'completed' || info.status === 'failed' || info.status === 'cancelled') {
        return info
      }
      if (Date.now() > deadline) {
        throw new Error(
          `[ai-sdk] vector-store file ingestion timed out after ${pollTimeout}ms ` +
          `(store=${storeId}, file=${fileId}, status=${info.status}). ` +
          'Increase pollTimeout or set wait: false for fire-and-forget.',
        )
      }
      await sleep(pollInterval)
      current = await client.vectorStores.files.retrieve(storeId, fileId)
    }
  }

  async removeFile(storeId: string, fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.vectorStores.files.del(storeId, fileId)
  }

  async listFiles(storeId: string, opts?: VectorStoreListOptions): Promise<VectorStoreFileList> {
    const client = await this.getClient()
    const params: Record<string, unknown> = {}
    if (opts?.limit  !== undefined) params['limit']  = opts.limit
    if (opts?.after  !== undefined) params['after']  = opts.after
    if (opts?.before !== undefined) params['before'] = opts.before
    const response = await client.vectorStores.files.list(storeId, params)
    const data = (response.data ?? []) as unknown[]
    return { files: data.map(d => fromOpenAIVectorStoreFile(d, storeId)) }
  }

  /** @internal — upload a local file via the Files API and return the
   *  provider's file id. Used when the user passes `filePath` or
   *  `fileBuffer` to `addFile` instead of an existing `fileId`. */
  private async uploadAndGetId(client: any, opts: VectorStoreAddOptions): Promise<string> {
    if (opts.filePath) {
      const { createReadStream } = await import(/* @vite-ignore */ 'node:fs' as string)
      const file = createReadStream(opts.filePath)
      const uploaded = await client.files.create({ file, purpose: 'assistants' })
      return uploaded.id
    }
    if (opts.fileBuffer) {
      const { toFile } = await import(/* @vite-ignore */ 'openai/uploads' as string) as { toFile: (data: Uint8Array, name: string) => Promise<unknown> }
      const file = await toFile(opts.fileBuffer.data, opts.fileBuffer.filename)
      const uploaded = await client.files.create({ file, purpose: 'assistants' })
      return uploaded.id
    }
    throw new Error(
      '[ai-sdk] addFile requires fileId, filePath, or fileBuffer. ' +
      'Pass an existing OpenAI file id via { fileId } or a local source via { filePath }.',
    )
  }
}

function fromOpenAIVectorStore(raw: unknown): VectorStoreInfo {
  const r = raw as {
    id: string; name: string; created_at: number;
    file_counts?: { total?: number; in_progress?: number; completed?: number; failed?: number; cancelled?: number };
    usage_bytes?: number; metadata?: Record<string, string>;
  }
  const fileCount =
    r.file_counts?.total ??
    (r.file_counts ? (r.file_counts.in_progress ?? 0) + (r.file_counts.completed ?? 0) + (r.file_counts.failed ?? 0) + (r.file_counts.cancelled ?? 0) : 0)
  const result: VectorStoreInfo = {
    id:        r.id,
    name:      r.name,
    createdAt: r.created_at,
    fileCount,
  }
  if (r.usage_bytes !== undefined) result.bytesUsed = r.usage_bytes
  if (r.metadata    !== undefined) result.metadata  = r.metadata
  return result
}

function fromOpenAIVectorStoreFile(raw: unknown, storeId: string): VectorStoreFileInfo {
  const r = raw as {
    id: string; created_at: number; status: string; usage_bytes?: number;
    attributes?: Record<string, string | number | boolean>;
    last_error?: { message: string } | null;
  }
  const status: VectorStoreFileInfo['status'] =
    r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled' || r.status === 'in_progress'
      ? r.status
      : 'in_progress'
  const result: VectorStoreFileInfo = {
    id:            r.id,
    vectorStoreId: storeId,
    status,
    createdAt:     r.created_at,
  }
  if (r.usage_bytes !== undefined)       result.bytes      = r.usage_bytes
  if (r.attributes  !== undefined)       result.attributes = r.attributes
  if (r.last_error?.message !== undefined) result.lastError = r.last_error.message
  return result
}
