import { parseOverview, serializeOverview } from './markdown.js'
import type { CodeOverview, OverviewFs } from './types.js'

/** Default location of the overview file, at the project/workspace root. */
export const OVERVIEW_FILE = 'CODE-OVERVIEW.md'

/**
 * Load a {@link CodeOverview} from `path`. A missing file yields `undefined` (the
 * expected first-run state) so callers can tell "never generated" from "empty".
 */
export async function loadOverview(fs: OverviewFs, path: string = OVERVIEW_FILE): Promise<CodeOverview | undefined> {
  if (!(await fs.exists(path))) return undefined
  return parseOverview(await fs.read(path))
}

/** Persist a {@link CodeOverview} to `path` as `CODE-OVERVIEW.md`. */
export async function saveOverview(
  fs: OverviewFs,
  overview: CodeOverview,
  path: string = OVERVIEW_FILE,
): Promise<void> {
  await fs.write(path, serializeOverview(overview))
}

/**
 * An {@link OverviewFs} backed by the host filesystem (`node:fs/promises`). The
 * import is dynamic so the overview core stays free of a hard `node:fs`
 * dependency — the map and its markdown work in any runtime; only this adapter
 * touches disk.
 */
export function nodeOverviewFs(): OverviewFs {
  return {
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8')
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, contents, 'utf8')
    },
    async exists(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
  }
}
