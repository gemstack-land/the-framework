import type {
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  FileContent,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'
import { createOpenAIClient } from './client.js'

// ─── Files ──────────────────────────────────────────────

export class OpenAIFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    this.client = await createOpenAIClient(this.config)
    return this.client
  }

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { createReadStream } = await import(/* @vite-ignore */ 'node:fs' as string)
    const file = createReadStream(options.filePath)
    const response = await client.files.create({
      file,
      purpose: options.purpose ?? 'assistants',
    })
    return {
      id: response.id,
      filename: response.filename,
      bytes: response.bytes,
      purpose: response.purpose,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for await (const f of response) {
      files.push({
        id: f.id,
        filename: f.filename,
        bytes: f.bytes,
        purpose: f.purpose,
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.del(fileId)
  }

  async retrieve(fileId: string): Promise<FileContent> {
    const client = await this.getClient()
    const response = await client.files.content(fileId)
    const buffer = Buffer.from(await response.arrayBuffer())
    return { data: buffer, mimeType: 'application/octet-stream' }
  }
}
