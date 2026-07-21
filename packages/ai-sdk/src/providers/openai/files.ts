import type {
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  FileContent,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'

// ─── Files ──────────────────────────────────────────────

export class OpenAIFileAdapter implements FileAdapter {
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
