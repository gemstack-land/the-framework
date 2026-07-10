import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The workspace documents the dashboard surfaces in its document sidebar (#319,
 * part of the MVP UI #309). The anti-lazy-pill (#301) has the agent write these
 * at the workspace root, so showing them lets the human read the plan + backlog
 * beside the run. Fixed filenames — never user input — so there is no path
 * traversal to guard against.
 */
export const SURFACED_DOCS = ['PLAN.md', 'TODO.md'] as const

/** One surfaced document: its filename and current contents. */
export interface WorkspaceDoc {
  name: string
  content: string
}

/** Cap a single doc so a runaway file can't bloat the `/api/docs` payload. */
const MAX_DOC_BYTES = 200_000

/**
 * Read the {@link SURFACED_DOCS} present at the workspace root, in that order.
 * Missing or blank files are skipped; a file over the size cap is truncated. Never
 * throws — a read error just omits that doc.
 */
export async function readDocs(cwd: string): Promise<WorkspaceDoc[]> {
  const docs: WorkspaceDoc[] = []
  for (const name of SURFACED_DOCS) {
    try {
      let content = await readFile(join(cwd, name), 'utf8')
      if (!content.trim()) continue
      if (content.length > MAX_DOC_BYTES) content = content.slice(0, MAX_DOC_BYTES) + '\n\n… (truncated)'
      docs.push({ name, content })
    } catch {
      // absent or unreadable — skip it
    }
  }
  return docs
}
