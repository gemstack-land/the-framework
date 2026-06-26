/**
 * Neutral storage contract for persisting generated binary assets (images,
 * audio).
 *
 * `@gemstack/ai-sdk` does not bundle or depend on any storage implementation.
 * Implement this one-method interface against whatever you store blobs in
 * (S3, GCS, the local filesystem, a framework's storage layer) and pass it to
 * {@link ImageGenerator.store} / {@link AudioGenerator.store}.
 *
 * ```ts
 * import { writeFile } from 'node:fs/promises'
 * const storage: StorageAdapter = { put: (path, bytes) => writeFile(path, bytes) }
 * await ImageGenerator.of('a logo').store('out/logo.png', storage)
 * ```
 */
export interface StorageAdapter {
  /** Persist raw bytes at a logical path/key. */
  put(path: string, bytes: Uint8Array): Promise<void> | void
}
