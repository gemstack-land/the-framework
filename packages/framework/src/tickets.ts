import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { TICKETING_FORMAT } from './prompts.generated.js'
import { THE_FRAMEWORK_DIR } from './logs.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * The root `tickets/` directory (#629): a plain repo convention where The Framework
 * keeps its human-facing roadmap files, rather than hiding them in a proprietary
 * `.the-framework/` dir. It sits beside conventions like a root `DECISIONS.md`. Since
 * #682 moved the backlog out to a root `TODO-AGENTS.md`, this directory holds only
 * ticket files (`<DATE>_<SLUG>.md`).
 */
export const TICKETS_DIR = 'tickets'

/**
 * The ticket-format spec (#684): the static reference an agent opens to learn the
 * `tickets/<DATE>_<SLUG>.md` (and `.spike.md`) file shape. Materialized under
 * `.the-framework/` beside the presets — not under `tickets/` — because it is
 * framework-authored and rides with the installed version, so it must not look like
 * a ticket. The #683 context fragment points `tickets/**.md` at this path.
 */
export const TICKETING_FORMAT_FILE = `${THE_FRAMEWORK_DIR}/ticketing-format.md`

/**
 * Write the ticket-format spec to `<cwd>/.the-framework/ticketing-format.md` so the
 * #683 context pointer resolves to a real file (#684). Mirrors {@link materializePresets}:
 * gitignored, overwritten on install, tracks the installed framework version rather than
 * going stale in the repo. Creates `.the-framework/` if it is missing.
 */
export async function materializeTicketingFormat(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<void> {
  await fs.mkdir(join(cwd, THE_FRAMEWORK_DIR))
  await fs.write(join(cwd, TICKETING_FORMAT_FILE), TICKETING_FORMAT)
}

/**
 * The flat, durable backlog/roadmap file — the confirmed-task queue (the "AI task queue"
 * the #683 context fragment names). Lives at the repo root as `TODO-AGENTS.md` (#682):
 * moved out of `tickets/` so that directory holds only tickets. This is the file a run
 * drains and the dashboard surfaces; the session-scoped `TODO_<slug>.agent.md` files the
 * system prompt writes are separate and also live at the root.
 */
export const FLAT_TODO_FILE = 'TODO-AGENTS.md'

/** The #629 backlog location (under `tickets/`), read as a fallback after #682 moved it to the root. */
export const LEGACY_TICKETS_TODO_FILE = `${TICKETS_DIR}/TODO.md`

/** The pre-#629 root location, still read so an older repo keeps its backlog. */
export const LEGACY_TODO_FILE = 'TODO.md'

/** Whether a workspace-relative path is an existing file. Never throws. */
async function isFile(cwd: string, rel: string): Promise<boolean> {
  return stat(join(cwd, rel))
    .then(s => s.isFile())
    .catch(() => false)
}

/**
 * The workspace's flat backlog file, newest convention first: the #682 root
 * `TODO-AGENTS.md`, else the #629 `tickets/TODO.md`, else the pre-#629 root `TODO.md`.
 * Returns the workspace-relative path, or `undefined` when none exists. New backlogs are
 * created at {@link FLAT_TODO_FILE}.
 */
export async function findFlatTodo(cwd: string): Promise<string | undefined> {
  for (const rel of [FLAT_TODO_FILE, LEGACY_TICKETS_TODO_FILE, LEGACY_TODO_FILE]) {
    if (await isFile(cwd, rel)) return rel
  }
  return undefined
}
