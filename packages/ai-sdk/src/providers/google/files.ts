import type {
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
} from '../../types.js'
import type { GoogleConfig } from './config.js'
import { createGoogleClient } from './client.js'
import { lazyClient } from '../lazy-client.js'

// ─── Files ──────────────────────────────────────────────

export class GoogleFileAdapter implements FileAdapter {
  constructor(private readonly config: GoogleConfig) {}

  private readonly getClient = lazyClient(() => createGoogleClient(this.config))

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { readFile, stat } = await import(/* @vite-ignore */ 'node:fs/promises' as string)
    const { basename } = await import(/* @vite-ignore */ 'node:path' as string)
    const data = await readFile(options.filePath)
    const stats = await stat(options.filePath)
    const filename = basename(options.filePath)

    const response = await client.files.upload({
      file: new Blob([data]),
      config: { displayName: filename },
    })

    return {
      id: response.name ?? response.uri,
      filename,
      bytes: stats.size,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for (const f of response.files ?? response ?? []) {
      files.push({
        id: f.name ?? f.uri,
        filename: f.displayName ?? f.name ?? '',
        bytes: Number(f.sizeBytes ?? 0),
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.delete({ name: fileId })
  }
}
