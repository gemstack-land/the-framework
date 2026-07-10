import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The plan/backlog document categories the dashboard surfaces in its sidebar
 * (#319, part of the MVP UI #309), so the human can read them beside the run.
 *
 * The Framework's system prompt writes these per session (#323/#326):
 * `PLAN_<SESSION>.agent.md` (the plan for now) and `TODO_<SESSION>.agent.md` (the
 * backlog), where SESSION is a git-branch slug. The flat `PLAN.md` / `TODO.md`
 * stay as a fallback for hand-written docs (and the current #301 prompt). Names are
 * matched against a flat readdir of the root, never taken from user input, so there
 * is no path traversal to guard against.
 */
export const DOC_CATEGORIES = [
  { flat: 'PLAN.md', scoped: /^PLAN_[a-z0-9-]+\.agent\.md$/ },
  { flat: 'TODO.md', scoped: /^TODO_[a-z0-9-]+\.agent\.md$/ },
] as const

/** One surfaced document: its filename and current contents. */
export interface WorkspaceDoc {
  name: string
  content: string
}

/** Cap a single doc so a runaway file can't bloat the `/api/docs` payload. */
const MAX_DOC_BYTES = 200_000

/**
 * The workspace-root filenames to surface, in sidebar order: per category the flat
 * file (if present) then its session-scoped files (sorted). Every name is a bare
 * readdir entry matched against a fixed pattern, so none can traverse. Returns
 * empty when the workspace is missing or unreadable.
 */
async function surfacedFilenames(cwd: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(cwd)
  } catch {
    return []
  }
  const present = new Set(entries)
  const names: string[] = []
  for (const { flat, scoped } of DOC_CATEGORIES) {
    if (present.has(flat)) names.push(flat)
    names.push(...entries.filter(e => scoped.test(e)).sort())
  }
  return names
}

/**
 * Read the surfaced plan/backlog docs at the workspace root, in sidebar order.
 * Missing or blank files are skipped; a file over the size cap is truncated. Never
 * throws — a read error just omits that doc.
 */
export async function readDocs(cwd: string): Promise<WorkspaceDoc[]> {
  const docs: WorkspaceDoc[] = []
  for (const name of await surfacedFilenames(cwd)) {
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
