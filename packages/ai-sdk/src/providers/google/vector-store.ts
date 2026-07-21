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
import type { GoogleConfig } from './config.js'
import { createGoogleClient } from './client.js'

// ─── Vector Stores (Gemini FileSearchStores, #B8.5) ──────
//
// Gemini's hosted RAG surface is `ai.fileSearchStores.*` — a direct
// OpenAI-equivalent that handles ingestion, chunking, embedding, and
// retrieval server-side. NOT available on Vertex AI; the underlying SDK
// methods throw for Vertex clients.
//
// Mapping decisions:
// - `VectorStoreInfo.id` is the full Gemini resource name
//   (`fileSearchStores/foo-bar`). Apps pass it back verbatim to `get` /
//   `delete` / `addFile`.
// - `VectorStoreInfo.name` is `displayName`. The OpenAI adapter populates
//   it from the store's name field; we use the user-supplied display name
//   to keep `create('Knowledge Base')` round-trip-able.
// - `createdAt` is parsed from ISO 8601 to Unix seconds for parity with
//   OpenAI's `created_at`.
// - `fileCount` sums `activeDocumentsCount + pendingDocumentsCount` (both
//   string-encoded). `failedDocumentsCount` is dropped — it's surfaced
//   per-file via `addFile`'s status when polling.
// - `bytesUsed` is parsed from `sizeBytes` (string-encoded).
// - Store-level `metadata` and `expiresAfter` are NOT supported by Gemini.
//   Passing them throws fail-loud so apps don't silently lose data.
//
// `addFile` paths:
// - `{ fileId }` → `importFile` (re-uses an existing Files API file).
// - `{ filePath | fileBuffer }` → `uploadToFileSearchStore` (single-shot
//   upload). Both paths return long-running operations; default
//   `wait: true` polls `client.operations.get` until `done`.
// - `attributes` (Record<string, primitive>) → Gemini's `customMetadata`
//   array shape; booleans coerce to `stringValue: 'true' | 'false'`.

export class GoogleVectorStoreAdapter implements VectorStoreAdapter {
  private client: any = null

  constructor(private readonly config: GoogleConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    this.client = await createGoogleClient(this.config)
    return this.client
  }

  async create(opts: VectorStoreCreateOptions): Promise<VectorStoreInfo> {
    if (opts.metadata) {
      throw new Error(
        '[ai-sdk] Gemini FileSearchStores does not support store-level metadata. ' +
        'Attach searchable metadata per-document via addFile({ attributes }).',
      )
    }
    if (opts.expiresAfter) {
      throw new Error(
        '[ai-sdk] Gemini FileSearchStores does not support expiresAfter. ' +
        'Stores persist until explicitly deleted via VectorStores.delete().',
      )
    }
    const client = await this.getClient()
    const response = await client.fileSearchStores.create({
      config: { displayName: opts.name },
    })
    return fromGeminiFileSearchStore(response, opts.name)
  }

  async list(opts?: VectorStoreListOptions): Promise<VectorStoreList> {
    const client = await this.getClient()
    const config: Record<string, unknown> = {}
    if (opts?.limit !== undefined) config['pageSize']  = opts.limit
    if (opts?.after !== undefined) config['pageToken'] = opts.after
    // Gemini paginates forward via pageToken only — `before` has no
    // equivalent. Drop it silently (matches OpenAI when `before` is unset).
    const pager = await client.fileSearchStores.list({ config })
    const items: unknown[] = Array.isArray(pager?.page) ? pager.page : []
    return { stores: items.map(item => fromGeminiFileSearchStore(item)) }
  }

  async get(id: string): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const response = await client.fileSearchStores.get({ name: id })
    return fromGeminiFileSearchStore(response)
  }

  async delete(id: string): Promise<void> {
    const client = await this.getClient()
    // `force: true` mirrors OpenAI's behavior — deleting a store also
    // drops attached documents. Without `force`, Gemini returns
    // FAILED_PRECONDITION when the store has any documents.
    await client.fileSearchStores.delete({ name: id, config: { force: true } })
  }

  async addFile(storeId: string, opts: VectorStoreAddOptions): Promise<VectorStoreFileInfo> {
    const client = await this.getClient()

    const customMetadata = opts.attributes ? attributesToCustomMetadata(opts.attributes) : undefined

    // Path 1: re-use an existing Files API file.
    if (opts.fileId) {
      const importConfig: Record<string, unknown> = {}
      if (customMetadata)        importConfig['customMetadata'] = customMetadata
      if (opts.chunkingStrategy) importConfig['chunkingConfig'] = opts.chunkingStrategy
      const op = await client.fileSearchStores.importFile({
        fileSearchStoreName: storeId,
        fileName: opts.fileId,
        config: importConfig,
      })
      return finishVectorStoreOperation(client, op, storeId, opts)
    }

    // Path 2: upload a local file directly. Either `filePath` or
    // `fileBuffer` is required — Gemini's SDK accepts a path string OR a
    // Blob. For `filePath`, the SDK infers mimeType from the extension;
    // for `fileBuffer`, it reads `blob.type` which is empty on a
    // untyped `new Blob([data])`, so we forward an explicit `mimeType`
    // derived from `filename` to avoid `Can not determine mimeType`.
    if (opts.filePath || opts.fileBuffer) {
      const uploadConfig: Record<string, unknown> = {}
      if (customMetadata)        uploadConfig['customMetadata'] = customMetadata
      if (opts.chunkingStrategy) uploadConfig['chunkingConfig'] = opts.chunkingStrategy
      if (opts.fileBuffer?.filename) uploadConfig['displayName'] = opts.fileBuffer.filename
      if (opts.fileBuffer?.filename) {
        const mimeType = mimeTypeFromFilename(opts.fileBuffer.filename)
        if (mimeType) uploadConfig['mimeType'] = mimeType
      }

      const file = opts.filePath ?? new Blob([opts.fileBuffer!.data])
      const op = await client.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeId,
        file,
        config: uploadConfig,
      })
      return finishVectorStoreOperation(client, op, storeId, opts)
    }

    throw new Error(
      '[ai-sdk] addFile requires fileId, filePath, or fileBuffer. ' +
      'Pass an existing Gemini Files API id via { fileId } (e.g. `files/abc-123`) or ' +
      'a local source via { filePath } / { fileBuffer }.',
    )
  }

  async removeFile(storeId: string, fileId: string): Promise<void> {
    const client = await this.getClient()
    // Document resource names are `fileSearchStores/<store>/documents/<doc>`.
    // Apps that pass the full path use it verbatim; apps that pass only
    // the document id get the store prefix joined for them.
    const name = fileId.includes('/documents/') ? fileId : `${storeId}/documents/${fileId}`
    await client.fileSearchStores.documents.delete({ name })
  }

  async listFiles(storeId: string, opts?: VectorStoreListOptions): Promise<VectorStoreFileList> {
    const client = await this.getClient()
    const config: Record<string, unknown> = {}
    if (opts?.limit !== undefined) config['pageSize']  = opts.limit
    if (opts?.after !== undefined) config['pageToken'] = opts.after
    const pager = await client.fileSearchStores.documents.list({ parent: storeId, config })
    const items: unknown[] = Array.isArray(pager?.page) ? pager.page : []
    return { files: items.map(doc => fromGeminiDocument(doc, storeId)) }
  }
}

/**
 * Wait for a long-running file ingestion operation to finish and map the
 * result into `VectorStoreFileInfo`. Honors `wait`/`pollInterval`/
 * `pollTimeout` from `VectorStoreAddOptions` (defaults: wait=true,
 * interval=1000ms, timeout=120_000ms).
 *
 * The terminal state of a Gemini ingestion op is exposed two ways:
 * - `op.error?: { code, message }` when ingestion failed.
 * - `op.response?: { documentName: 'fileSearchStores/.../documents/...' }`
 *   when successful.
 *
 * On success we follow up with a single `documents.get` to fetch
 * `state` / `sizeBytes` / `createTime`. On failure we surface the error
 * message via `lastError` and the status flips to `'failed'`.
 */
async function finishVectorStoreOperation(
  client: any,
  initialOp: any,
  storeId: string,
  opts: VectorStoreAddOptions,
): Promise<VectorStoreFileInfo> {
  if (opts.wait === false) {
    return {
      id:            initialOp?.name ?? `${storeId}/documents/pending-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'in_progress',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  const pollInterval = opts.pollInterval ?? 1000
  const pollTimeout  = opts.pollTimeout  ?? 120_000
  const deadline     = Date.now() + pollTimeout

  let current = initialOp
  while (!current?.done) {
    if (Date.now() > deadline) {
      throw new Error(
        `[ai-sdk] Gemini FileSearchStore ingestion timed out after ${pollTimeout}ms ` +
        `(store=${storeId}). Increase pollTimeout or set wait: false for fire-and-forget.`,
      )
    }
    await sleep(pollInterval)
    current = await client.operations.get({ operation: current })
  }

  if (current.error) {
    const errMessage = (current.error as { message?: string }).message ?? 'unknown error'
    return {
      id:            current.name ?? `${storeId}/documents/failed-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'failed',
      createdAt:     Math.floor(Date.now() / 1000),
      lastError:     errMessage,
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  const documentName: string | undefined = current.response?.documentName
  if (!documentName) {
    // Op done, no error, no documentName — surface as completed without
    // follow-up details rather than failing.
    return {
      id:            current.name ?? `${storeId}/documents/unknown-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'completed',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  // Follow up with documents.get to surface real createdAt + sizeBytes.
  // Best-effort: if the get fails (rare race), fall back to the op data.
  try {
    const doc = await client.fileSearchStores.documents.get({ name: documentName })
    const info = fromGeminiDocument(doc, storeId)
    if (opts.attributes && !info.attributes) info.attributes = opts.attributes
    return info
  } catch {
    return {
      id:            documentName,
      vectorStoreId: storeId,
      status:        'completed',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }
}

/**
 * Map a Gemini `FileSearchStore` resource into the framework's
 * `VectorStoreInfo` shape. `displayNameOverride` lets `create()` populate
 * the human-friendly name from the user-supplied value when the API
 * response omits it (some response variants do).
 *
 * @internal
 */
export function fromGeminiFileSearchStore(raw: unknown, displayNameOverride?: string): VectorStoreInfo {
  const r = raw as {
    name?: string
    displayName?: string
    createTime?: string
    activeDocumentsCount?: string
    pendingDocumentsCount?: string
    sizeBytes?: string
  }
  const id = r.name ?? ''
  const active  = Number(r.activeDocumentsCount  ?? 0) || 0
  const pending = Number(r.pendingDocumentsCount ?? 0) || 0
  const result: VectorStoreInfo = {
    id,
    name:      r.displayName ?? displayNameOverride ?? id,
    createdAt: r.createTime ? Math.floor(Date.parse(r.createTime) / 1000) : Math.floor(Date.now() / 1000),
    fileCount: active + pending,
  }
  if (r.sizeBytes !== undefined) {
    const bytes = Number(r.sizeBytes)
    if (Number.isFinite(bytes)) result.bytesUsed = bytes
  }
  return result
}

/**
 * Map a Gemini `Document` resource into the framework's
 * `VectorStoreFileInfo` shape. `DocumentState` enum values flatten to the
 * shared `'in_progress' | 'completed' | 'failed' | 'cancelled'` union.
 *
 * @internal
 */
export function fromGeminiDocument(raw: unknown, storeId: string): VectorStoreFileInfo {
  const r = raw as {
    name?: string
    state?: string
    sizeBytes?: string
    createTime?: string
    customMetadata?: Array<{ key?: string; stringValue?: string; numericValue?: number; stringListValue?: { values?: string[] } }>
  }
  const status = mapGeminiDocumentState(r.state)
  const result: VectorStoreFileInfo = {
    id:            r.name ?? `${storeId}/documents/unknown`,
    vectorStoreId: storeId,
    status,
    createdAt:     r.createTime ? Math.floor(Date.parse(r.createTime) / 1000) : Math.floor(Date.now() / 1000),
  }
  if (r.sizeBytes !== undefined) {
    const bytes = Number(r.sizeBytes)
    if (Number.isFinite(bytes)) result.bytes = bytes
  }
  if (r.customMetadata && r.customMetadata.length > 0) {
    result.attributes = customMetadataToAttributes(r.customMetadata)
  }
  return result
}

function mapGeminiDocumentState(state: string | undefined): VectorStoreFileInfo['status'] {
  switch (state) {
    case 'STATE_ACTIVE':  return 'completed'
    case 'STATE_FAILED':  return 'failed'
    case 'STATE_PENDING': return 'in_progress'
    default:              return 'in_progress'
  }
}

/**
 * Convert the framework's flat attribute map to Gemini's `CustomMetadata`
 * array shape. Strings → `stringValue`, numbers → `numericValue`,
 * booleans → `stringValue: 'true' | 'false'` (Gemini has no boolean
 * variant — string is the safe lossless choice; filter-builders can
 * still match on `key = "true"`).
 *
 * @internal
 */
export function attributesToCustomMetadata(
  attrs: Record<string, string | number | boolean>,
): Array<{ key: string; stringValue?: string; numericValue?: number }> {
  return Object.entries(attrs).map(([key, value]) => {
    if (typeof value === 'number') return { key, numericValue: value }
    if (typeof value === 'boolean') return { key, stringValue: value ? 'true' : 'false' }
    return { key, stringValue: value }
  })
}

/**
 * Inverse of {@link attributesToCustomMetadata}. Drops `stringListValue`
 * variants (no flat-attribute representation; apps that need lists
 * should read the raw Document via the SDK).
 *
 * @internal
 */
export function customMetadataToAttributes(
  metadata: Array<{ key?: string; stringValue?: string; numericValue?: number; stringListValue?: { values?: string[] } }>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const entry of metadata) {
    if (!entry.key) continue
    if (entry.numericValue !== undefined) out[entry.key] = entry.numericValue
    else if (entry.stringValue !== undefined) {
      // Round-trip booleans encoded by attributesToCustomMetadata.
      if      (entry.stringValue === 'true')  out[entry.key] = true
      else if (entry.stringValue === 'false') out[entry.key] = false
      else                                    out[entry.key] = entry.stringValue
    }
    // stringListValue intentionally dropped.
  }
  return out
}

/**
 * Best-effort MIME type from a filename extension. Gemini's
 * `uploadToFileSearchStore` requires a mimeType on Blob uploads (it
 * reads `blob.type`, which is empty on untyped `new Blob([data])`).
 *
 * Coverage matches Gemini's supported FileSearchStore document formats.
 * Unknown extensions return `''` — the caller drops the field so the
 * Gemini SDK's own error fires loudly rather than silently picking a
 * wrong type.
 *
 * @internal
 */
export function mimeTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'txt':  return 'text/plain'
    case 'md':   return 'text/markdown'
    case 'pdf':  return 'application/pdf'
    case 'html':
    case 'htm':  return 'text/html'
    case 'json': return 'application/json'
    case 'csv':  return 'text/csv'
    case 'tsv':  return 'text/tab-separated-values'
    case 'xml':  return 'application/xml'
    case 'rtf':  return 'application/rtf'
    case 'doc':  return 'application/msword'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'js':   return 'text/javascript'
    case 'ts':   return 'text/x-typescript'
    case 'py':   return 'text/x-python'
    default:     return ''
  }
}
