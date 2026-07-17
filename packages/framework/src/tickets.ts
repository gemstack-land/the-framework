import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The root `tickets/` directory (#629): a plain repo convention where The Framework
 * keeps its human-facing roadmap files, rather than hiding them in a proprietary
 * `.the-framework/` dir. It sits beside conventions like a root `DECISIONS.md`, and
 * is where the durable backlog (`tickets/TODO.md`) and, later, ticket files live.
 */
export const TICKETS_DIR = 'tickets'

/**
 * The flat, durable backlog/roadmap file — the confirmed-task queue. Moved under
 * `tickets/` in #629 (it used to sit at the repo root). This is the one a run drains
 * and the dashboard surfaces; the session-scoped `TODO_<slug>.agent.md` files the
 * system prompt writes are separate and stay at the root.
 */
export const FLAT_TODO_FILE = `${TICKETS_DIR}/TODO.md`

/** The pre-#629 root location, still read so an existing repo keeps its backlog. */
export const LEGACY_TODO_FILE = 'TODO.md'

/** Whether a workspace-relative path is an existing file. Never throws. */
async function isFile(cwd: string, rel: string): Promise<boolean> {
  return stat(join(cwd, rel))
    .then(s => s.isFile())
    .catch(() => false)
}

/**
 * The workspace's flat backlog file: the #629 `tickets/TODO.md` if present, else a
 * legacy root `TODO.md`. Returns the workspace-relative path, or `undefined` when
 * neither exists. New backlogs are created at {@link FLAT_TODO_FILE}.
 */
export async function findFlatTodo(cwd: string): Promise<string | undefined> {
  if (await isFile(cwd, FLAT_TODO_FILE)) return FLAT_TODO_FILE
  if (await isFile(cwd, LEGACY_TODO_FILE)) return LEGACY_TODO_FILE
  return undefined
}
