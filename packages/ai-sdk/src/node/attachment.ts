import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DocumentAttachment, ImageAttachment } from '../attachment.js'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
}

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

/** Load a DocumentAttachment from a local file path (Node-only). */
export async function documentFromPath(path: string): Promise<DocumentAttachment> {
  const buffer = await readFile(path)
  const base64 = buffer.toString('base64')
  return DocumentAttachment.fromBase64(base64, mimeFromPath(path), basename(path))
}

/** Load an ImageAttachment from a local file path (Node-only). */
export async function imageFromPath(path: string): Promise<ImageAttachment> {
  const buffer = await readFile(path)
  const base64 = buffer.toString('base64')
  return ImageAttachment.fromBase64(base64, mimeFromPath(path))
}
