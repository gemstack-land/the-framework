import { stat } from 'node:fs/promises'

/** True if `path` exists and is a regular file. Never throws. */
export async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

/** True if `path` exists and is a directory. Never throws. */
export async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}
