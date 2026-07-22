import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The root `tickets/` directory (#629): a plain repo convention where The Framework
 * keeps its human-facing roadmap files, rather than hiding them in a proprietary
 * `.the-framework/` dir. It sits beside conventions like the `knowledge-base/` docs. Since
 * #682 moved the backlog out to a root `TODO_AGENTS.md`, this directory holds only
 * ticket files (`<DATE>_<SLUG>.md`).
 */
export const TICKETS_DIR = 'tickets'

/**
 * The ticket-format spec (#684): the static reference an agent opens to learn the
 * `tickets/<DATE>_<SLUG>.md` (and `.spike.md` / `.plan.md`) file shape. Per the #674 call it ships
 * *inside the installed package* rather than being materialized into the repo, so a future
 * breaking change to the format rides with the package version instead of going stale in a
 * committed file. The package ships `prompts/ticketing_format.md` (see the `files` allowlist),
 * so an agent reads it at this cwd-relative path; the #683 context fragment points here.
 */
export const TICKETING_FORMAT_FILE = 'node_modules/@gemstack/framework/prompts/ticketing_format.md'

/**
 * The flat, durable backlog/roadmap file — the confirmed-task queue (the "AI task queue"
 * the #683 context fragment names). Lives at the repo root as `TODO_AGENTS.md` (#682):
 * moved out of `tickets/` so that directory holds only tickets. This is the file a run
 * drains and the dashboard surfaces; the session-scoped `TODO_<slug>.agent.md` files the
 * system prompt writes are separate and also live at the root.
 */
export const FLAT_TODO_FILE = 'TODO_AGENTS.md'

/**
 * The backlog-format spec (#880): the static reference an agent opens to learn how
 * {@link FLAT_TODO_FILE} is laid out — priority sections, URGENT first. Ships inside the
 * installed package for the same reason as {@link TICKETING_FORMAT_FILE}, and the #683 context
 * fragment points here. The priority sections need no parser support: `parseTodoEntries` skips
 * headings and returns entries in file order, so a priority-sorted file drains in priority order.
 */
export const TODO_FORMAT_FILE = 'node_modules/@gemstack/framework/prompts/todo_format.md'

/** The brief hyphen spelling from #682, read as a fallback after #674 settled on the underscore. */
export const LEGACY_HYPHEN_TODO_FILE = 'TODO-AGENTS.md'

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
 * The workspace's flat backlog file, newest convention first: the root `TODO_AGENTS.md`,
 * else the brief hyphen spelling, else the #629 `tickets/TODO.md`, else the pre-#629 root
 * `TODO.md`. Returns the workspace-relative path, or `undefined` when none exists. New
 * backlogs are created at {@link FLAT_TODO_FILE}.
 */
export async function findFlatTodo(cwd: string): Promise<string | undefined> {
  for (const rel of [FLAT_TODO_FILE, LEGACY_HYPHEN_TODO_FILE, LEGACY_TICKETS_TODO_FILE, LEGACY_TODO_FILE]) {
    if (await isFile(cwd, rel)) return rel
  }
  return undefined
}
