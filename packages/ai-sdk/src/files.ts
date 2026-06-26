import { AiRegistry } from './registry.js'
import type { FileUploadResult, FileListResult, FileContent } from './types.js'

/**
 * Provider file management — upload, list, delete, and retrieve files
 * on provider platforms (OpenAI, Anthropic, Google).
 *
 * @example
 * const files = AI.files('openai')
 * const uploaded = await files.upload('./report.pdf', { purpose: 'assistants' })
 * const list = await files.list()
 * await files.delete(uploaded.id)
 */
export class FileManager {
  private constructor(private readonly providerName: string) {}

  static for(providerName: string): FileManager {
    return new FileManager(providerName)
  }

  /** Upload a file to the provider */
  async upload(filePath: string, options?: { purpose?: string | undefined }): Promise<FileUploadResult> {
    const adapter = AiRegistry.resolveFiles(this.providerName)
    return adapter.upload({ filePath, purpose: options?.purpose })
  }

  /** List all files on the provider */
  async list(): Promise<FileListResult> {
    const adapter = AiRegistry.resolveFiles(this.providerName)
    return adapter.list()
  }

  /** Delete a file by ID */
  async delete(fileId: string): Promise<void> {
    const adapter = AiRegistry.resolveFiles(this.providerName)
    return adapter.delete(fileId)
  }

  /** Retrieve file content by ID (not all providers support this) */
  async retrieve(fileId: string): Promise<FileContent> {
    const adapter = AiRegistry.resolveFiles(this.providerName)
    if (!adapter.retrieve) {
      throw new Error(`[ai-sdk] Provider "${this.providerName}" does not support file retrieval.`)
    }
    return adapter.retrieve(fileId)
  }
}
