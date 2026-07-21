import type {
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
} from '../../types.js'
import type { GoogleConfig } from './config.js'

// ─── Files ──────────────────────────────────────────────

export class GoogleFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: GoogleConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

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
