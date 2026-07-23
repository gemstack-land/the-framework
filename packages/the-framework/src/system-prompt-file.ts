import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reading the user's own `SYSTEM.md` off disk — the one Node-bound half of the
 * system prompt, kept apart from the composition itself (#520).
 *
 * The split is what lets the dashboard render the prompt in the browser: a
 * bundler that reaches `system-prompt.ts` must not find `node:fs` behind it, and
 * `client.ts` promises exactly that. Everything here takes a `dir` and hands back
 * a string, which the pure side takes as plain input.
 */

/** The user's system prompt file, read from the workspace root. */
export const SYSTEM_PROMPT_FILE = 'SYSTEM.md'

/**
 * Read the user's system prompt from {@link SYSTEM_PROMPT_FILE} at the workspace
 * root. Returns `undefined` when the file is absent or empty, so the caller falls
 * back to the built-in default alone.
 */
export async function loadUserSystemPrompt(
  dir: string,
  file: string = SYSTEM_PROMPT_FILE,
): Promise<string | undefined> {
  try {
    const content = (await readFile(join(dir, file), 'utf8')).trim()
    return content || undefined
  } catch {
    return undefined
  }
}
