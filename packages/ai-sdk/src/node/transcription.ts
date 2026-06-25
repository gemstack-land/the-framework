import { readFile } from 'node:fs/promises'
import { Transcription } from '../transcription.js'

/** Create a Transcription from a local file path (Node-only). */
export async function transcribeFromPath(path: string): Promise<Transcription> {
  const buffer = await readFile(path)
  return Transcription.fromBytes(new Uint8Array(buffer))
}
