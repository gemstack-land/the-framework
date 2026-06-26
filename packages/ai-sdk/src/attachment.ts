import { toBase64 } from './base64.js'
import type { Attachment, ContentPart } from './types.js'

// ─── Document ────────────────────────────────────────────

export class DocumentAttachment {
  private constructor(
    private readonly _data: string,
    private readonly _mimeType: string,
    private readonly _name?: string,
  ) {}

  /** Create from raw string content */
  static fromString(content: string, name?: string): DocumentAttachment {
    return new DocumentAttachment(toBase64(content), 'text/plain', name)
  }

  /** Create from a base64 string */
  static fromBase64(base64: string, mimeType: string, name?: string): DocumentAttachment {
    return new DocumentAttachment(base64, mimeType, name)
  }

  /** Create from a URL (fetches the content) */
  static async fromUrl(url: string): Promise<DocumentAttachment> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`[ai-sdk] Failed to fetch document: ${res.status} ${url}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
    const name = url.split('/').pop()?.split('?')[0]
    return new DocumentAttachment(toBase64(bytes), mimeType, name)
  }

  toAttachment(): Attachment {
    const a: Attachment = { type: 'document', data: this._data, mimeType: this._mimeType }
    if (this._name) a.name = this._name
    return a
  }

  toContentPart(): ContentPart {
    const p: ContentPart = { type: 'document', data: this._data, mimeType: this._mimeType }
    if (this._name) (p as { name?: string }).name = this._name
    return p
  }
}

// ─── Image ───────────────────────────────────────────────

export class ImageAttachment {
  private constructor(
    private readonly _data: string,
    private readonly _mimeType: string,
  ) {}

  /** Create from a base64 string */
  static fromBase64(base64: string, mimeType: string): ImageAttachment {
    return new ImageAttachment(base64, mimeType)
  }

  /** Create from a URL (fetches the image) */
  static async fromUrl(url: string): Promise<ImageAttachment> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`[ai-sdk] Failed to fetch image: ${res.status} ${url}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/png'
    return new ImageAttachment(toBase64(bytes), mimeType)
  }

  toAttachment(): Attachment {
    return { type: 'image', data: this._data, mimeType: this._mimeType }
  }

  toContentPart(): ContentPart {
    return { type: 'image', data: this._data, mimeType: this._mimeType }
  }
}

// ─── Helpers ─────────────────────────────────────────────

/** Convert attachments to ContentPart[] for building a user message */
export function attachmentsToContentParts(attachments: Attachment[]): ContentPart[] {
  return attachments.map(a => {
    if (a.type === 'image') return { type: 'image' as const, data: a.data, mimeType: a.mimeType }
    const part: ContentPart = { type: 'document' as const, data: a.data, mimeType: a.mimeType }
    if (a.name) (part as { name?: string }).name = a.name
    return part
  })
}

/** Get text content from a message (handles both string and ContentPart[] content) */
export function getMessageText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}
