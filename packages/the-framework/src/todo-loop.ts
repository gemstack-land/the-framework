import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DriverSession } from './driver/index.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { requestChoices, runAwaitRounds } from './await-gate.js'
import { FLAT_TODO_FILE, findFlatTodo, ticketFromQueueEntry } from './tickets.js'
import { drainsQueue } from './preset-catalog.js'
import { createTurnSignalEmitter } from './turn-gate.js'

export { FLAT_TODO_FILE, LEGACY_HYPHEN_TODO_FILE, LEGACY_TICKETS_TODO_FILE, LEGACY_TODO_FILE, TICKETS_DIR, ticketFromQueueEntry, todoPriorityForTicket } from './tickets.js'

/**
 * The backlog loop (#323): once the main work settles, consume the agent's own
 * TODO backlog one entry per turn until it is empty. The agent writes the
 * backlog itself (a very large scope, the Maintenance follow-ups, or the
 * [Research] preset's deep-dive picks all append entries); the framework only
 * drives: read the file, gate ("start the next item?") when someone can answer,
 * prompt the agent to complete exactly one entry and check it off, repeat.
 * Termination is Rom's call on the issue: stop when the backlog is empty. The
 * dashboard's autopilot auto-accepts the per-item gate, so `[x] autopilot`
 * consumes the whole backlog unattended; autopilot off pauses before each entry.
 */

/** A located backlog: its filename and the entries still open. */
export interface TodoBacklog {
  /** The backlog filename (workspace-root relative, e.g. `TODO_AGENTS.md`). */
  name: string
  /** The open (unchecked) entries, in file order. */
  entries: string[]
}

/**
 * The open entries of a backlog document: markdown list items (`-`, `*`, or
 * `1.`), where a task checkbox counts only while unchecked (`- [ ]`); a checked
 * `- [x]` entry is done. Headings, prose, and blank lines are not entries.
 */
export function parseTodoEntries(md: string): string[] {
  const entries: string[] = []
  for (const line of md.split('\n')) {
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
    if (!item) continue
    const text = item[1]!.trim()
    if (!text) continue
    const task = /^\[([ xX])\]\s*(.*)$/.exec(text)
    if (task) {
      if (task[1] !== ' ') continue // checked off = done
      if (task[2]!.trim()) entries.push(task[2]!.trim())
    } else {
      entries.push(text)
    }
  }
  return entries
}

/**
 * Append an open entry to the workspace's backlog, creating the flat {@link FLAT_TODO_FILE}
 * when the workspace has none. Resolves with the file written, or `undefined` if
 * it couldn't be written.
 *
 * This is how a paused run leaves word to pick itself up again (#529): the
 * backlog is already the thing a later run drains, so a resume note needs no
 * machinery of its own. Never throws — it is called while a run is already
 * unwinding, and must not mask the reason it stopped.
 */
export async function appendTodoEntry(cwd: string, entry: string): Promise<string | undefined> {
  return writeTodoEntry(cwd, (await findFlatTodo(cwd)) ?? FLAT_TODO_FILE, entry)
}

/**
 * Append an open entry to the workspace's flat backlog with a priority, creating
 * {@link FLAT_TODO_FILE} when there is none.
 *
 * The difference from {@link appendTodoEntry} is the priority placement (#1164): a dashboard
 * pick (#697) lands in its `## Priority N` section rather than at the end of the file. The flat
 * file is the durable global queue #624 settled on, and the only one `promoteQueue` carries
 * between branches (#852).
 */
export async function appendFlatTodoEntry(
  cwd: string,
  entry: string,
  priority?: number,
): Promise<string | undefined> {
  return writeTodoEntry(cwd, (await findFlatTodo(cwd)) ?? FLAT_TODO_FILE, entry, priority)
}

/** A `## Priority 7` heading, with whatever gloss the format's example puts after the number. */
const PRIORITY_HEADING = /^##\s+priority\s+(\d{1,2})\b/i

/** Any second-level heading, which is where a priority section ends. */
const SECTION_HEADING = /^##\s+/

/**
 * Place an open entry in the backlog's priority section (`prompts/todo_format.md`), creating the
 * section when the file has none, and return the new document.
 *
 * Pure, because the placement is the whole point and it is much easier to pin here than through
 * the filesystem. The old behaviour was a plain append, which put a just-queued ticket at the
 * *end* of the file — and since the drain preset works "the FIRST open entry" and
 * {@link parseTodoEntries} reads in file order, queueing something meant it would be worked last,
 * behind everything already there (#1164).
 *
 * Placement rules, in the order they are tried:
 * - a section for this priority already exists: the entry joins the end of it, so a queue keeps
 *   its arrival order within a priority
 * - otherwise the section is created before the first *lower*-priority section, since the format
 *   sorts high to low
 * - with no priority sections at all, it goes above the first heading of any kind: the file's
 *   own sections are then unranked, and burying a deliberate pick under them is the bug
 */
export function insertTodoEntry(md: string, entry: string, priority: number): string {
  const item = `- [ ] ${entry}`
  const lines = md.split('\n')
  const headings = lines
    .map((line, index) => ({ index, priority: Number(PRIORITY_HEADING.exec(line)?.[1]) }))
    .filter(h => Number.isFinite(h.priority))

  const existing = headings.find(h => h.priority === priority)
  if (existing) {
    // The end of that section: the last line before the next heading that is not blank, so the
    // entry lands under the section's last item rather than after its trailing blank line.
    let end = lines.findIndex((line, index) => index > existing.index && SECTION_HEADING.test(line))
    if (end === -1) end = lines.length
    while (end > existing.index + 1 && lines[end - 1]!.trim() === '') end--
    lines.splice(end, 0, item)
    return lines.join('\n')
  }

  const section = [`## Priority ${priority}`, '', item, '']
  const lower = headings.find(h => h.priority < priority)
  if (lower) {
    lines.splice(lower.index, 0, ...section)
    return lines.join('\n')
  }
  if (headings.length) {
    // Every existing section outranks it, so it goes last -- but still as its own section.
    const last = headings[headings.length - 1]!
    let end = lines.findIndex((line, index) => index > last.index && SECTION_HEADING.test(line))
    if (end === -1) end = lines.length
    while (end > last.index + 1 && lines[end - 1]!.trim() === '') end--
    lines.splice(end, 0, '', ...section.slice(0, 3))
    return lines.join('\n')
  }
  const firstHeading = lines.findIndex(line => SECTION_HEADING.test(line))
  if (firstHeading === -1) {
    const separator = md === '' || md.endsWith('\n') ? '' : '\n'
    return `${md}${separator}${section.slice(0, 3).join('\n')}\n`
  }
  lines.splice(firstHeading, 0, ...section)
  return lines.join('\n')
}

/**
 * Write one open entry to a named backlog file. Never throws; resolves with the file written.
 *
 * With no `priority` this stays the plain append it always was: the resume note (#529) and the
 * agent's own follow-ups are a running list, and the file's order is theirs to keep.
 */
async function writeTodoEntry(
  cwd: string,
  name: string,
  entry: string,
  priority?: number,
): Promise<string | undefined> {
  const path = join(cwd, name)
  try {
    const existing = await readFile(path, 'utf8').catch(() => '')
    await mkdir(dirname(path), { recursive: true }) // a legacy tickets/TODO.md still needs its dir
    if (priority !== undefined) {
      await writeFile(path, insertTodoEntry(existing, entry, priority), 'utf8')
      return name
    }
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
    await writeFile(path, `${existing}${separator}- [ ] ${entry}\n`, 'utf8')
    return name
  } catch {
    return undefined
  }
}

/**
 * Locate the workspace's backlog and its open entries: the flat file via `findFlatTodo`
 * (`TODO_AGENTS.md`, or a legacy `tickets/TODO.md` / root `TODO.md`). Returns `undefined`
 * when no backlog exists or it has no open entry. Session-scoped `TODO_<slug>.agent.md`
 * files are retired (#1369) — a leftover one in the checkout is ignored.
 */
export async function findTodoBacklog(cwd: string): Promise<TodoBacklog | undefined> {
  const name = await findFlatTodo(cwd)
  if (!name) return undefined
  const md = await readFile(join(cwd, name), 'utf8').catch(() => undefined)
  if (md === undefined) return undefined
  const entries = parseTodoEntries(md)
  return entries.length ? { name, entries } : undefined
}

/**
 * Does this session's own backlog still have open work (#1363)?
 *
 * Reads only `TODO_<SESSION_NAME>.agent.md` — the file the [Research] preset (and a very-large
 * scope) has the agent keep for its own session. Never the global `TODO_AGENTS.md`: the queue is
 * decoupled from sessions (#1390), and withholding a merge on it would mean auto-merge never
 * fires while the project has any backlog at all. `false` on a missing or unreadable file, and on
 * a session name that could not name a file — no pendingness known is not pendingness.
 *
 * TEMPORARY SAFETY BELT, built to be deleted (#1390): the agent's setReadyForMerge() is the
 * authorization, and this only catches the agent declaring done while its own session file says
 * otherwise. When the agent's word is deemed enough, delete this function and its single call
 * site in `maybeAutoHandoff`.
 */
export async function sessionTodoPending(cwd: string, sessionName: string | undefined): Promise<boolean> {
  // The prompt asks for [a-z0-9-]+; anything wider (a path separator above all) names no file.
  if (!sessionName || !/^[A-Za-z0-9._-]+$/.test(sessionName)) return false
  const md = await readFile(join(cwd, `TODO_${sessionName}.agent.md`), 'utf8').catch(() => undefined)
  return md !== undefined && parseTodoEntries(md).length > 0
}

/**
 * The ticket the next drain run will pick up, or `undefined` when there is none (#1117).
 *
 * "Next" is the first open entry of the flat backlog, because that is what the [Drain queue]
 * preset says to work ("the FIRST open entry only") and {@link parseTodoEntries} returns entries
 * in file order. Read from the project checkout, the same copy the sweep already consults when it
 * decides whether there is anything to drain, so the entry this names is the entry that decision
 * was made on.
 *
 * A best guess by construction: the run reads its own worktree a moment later, and an entry
 * checked off in between would move it on. Being wrong here costs a mislabelled lane on the
 * Overview and nothing else — no run is started or steered by this.
 */
export async function nextQueuedTicket(cwd: string): Promise<string | undefined> {
  const name = await findFlatTodo(cwd)
  if (!name) return undefined
  const md = await readFile(join(cwd, name), 'utf8').catch(() => undefined)
  if (md === undefined) return undefined
  const first = parseTodoEntries(md)[0]
  return first ? ticketFromQueueEntry(first) : undefined
}

/**
 * The ticket a run started by hand is about to implement, when that run is a drain (#1117).
 *
 * The daemon already does this for the sweep's own drain, off the `drains` flag on the job. A run
 * fired from the dashboard reaches the same start with none of that context, so a hand-fired drain
 * showed up working on nothing: the run implemented the ticket, and the lane it belonged in stayed
 * empty. Same read as the sweep's, so both agree on which entry is next.
 *
 * Undefined for anything that is not a drain, and for a drain over an empty queue. The `read` seam
 * is for tests; production always takes the default.
 */
export async function ticketForPrompt(
  prompt: string,
  cwd: string,
  read: (cwd: string) => Promise<string | undefined> = nextQueuedTicket,
): Promise<string | undefined> {
  if (!drainsQueue(prompt)) return undefined
  return read(cwd).catch(() => undefined)
}

/**
 * Leave a "resume me" entry on the workspace's backlog, so a later run picks the
 * paused work back up (Rom's call on #519). The backlog is already what a run
 * drains, so this needs no machinery of its own.
 *
 * Named after the session when the agent gave itself one, since that is what the
 * user recognizes; an unnamed run says so plainly rather than inventing an id.
 */
export async function leaveResumeNote(
  cwd: string,
  events: readonly FrameworkEvent[],
  emit: (event: FrameworkEvent) => void,
): Promise<string | undefined> {
  const named = [...events]
    .reverse()
    .find((e): e is Extract<FrameworkEvent, { kind: 'session-name' }> => e.kind === 'session-name')
  const entry = `Resume ${named?.name ?? 'the paused session'}`
  const file = await appendTodoEntry(cwd, entry)
  if (file) emit({ kind: 'log', message: `Left "${entry}" on ${file} to pick up when the limit resets.` })
  return file
}

/** Why the loop ended. */
export type TodoLoopReason =
  /** The backlog is empty (or was never written) — the success case. */
  | 'empty'
  /** The user picked "stop" at a per-item gate. */
  | 'stopped'
  /** Two items in a row left the backlog's next entry untouched. */
  | 'stalled'
  /** The item cap was reached with entries still open. */
  | 'max-items'

/** What {@link runTodoLoop} resolves with. */
export interface TodoLoopResult {
  /** Backlog entries worked (turns taken), regardless of outcome. */
  completed: number
  /** Why the loop ended. */
  reason: TodoLoopReason
  /** The backlog filename, when one was found. */
  file?: string
}

/** Options for {@link runTodoLoop}. */
export interface TodoLoopOptions {
  /** The live driver session the run already owns. */
  session: DriverSession
  /** The workspace the backlog lives in. */
  cwd: string
  /** Emit the loop's events onto the run stream. */
  emit: (event: FrameworkEvent) => void
  /**
   * The interactive gate handler (#304). When wired, the loop pauses before each
   * entry ("start the next item?") — the dashboard's autopilot auto-accepts, so
   * autopilot off means a human gate per item (#323). Headless runs don't pause.
   */
  requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
  /** The run signal; aborting (Stop button / budget cap #322) ends the loop. */
  signal?: AbortSignal | undefined
  /** Hard cap on entries worked in one run. Default {@link DEFAULT_MAX_TODO_ITEMS}. */
  maxItems?: number | undefined
}

/** The default per-run cap on backlog entries — a backstop beside the budget cap (#322). */
export const DEFAULT_MAX_TODO_ITEMS = 25

/** How many consecutive no-progress items before the loop stops rather than spins. */
const MAX_STALLS = 2

/**
 * Drive the backlog to empty: read the next open entry, gate, prompt the agent
 * to complete exactly that entry and check it off, and repeat. Caps make it safe
 * to leave unattended (#322's concern): the run's budget/abort signal ends any
 * turn, a hard item cap bounds the run, and two consecutive items that leave the
 * next entry untouched stop the loop instead of spinning. A backlog turn is a turn
 * like any other: await gates (`showChoices()` / `showMultiSelect()`) and the signals
 * (`showMarkdown()`, `setSessionName()`, `setReadyForMerge()`) are honored here too.
 */
export async function runTodoLoop(opts: TodoLoopOptions): Promise<TodoLoopResult> {
  const { session, cwd, emit } = opts
  const maxItems = opts.maxItems ?? DEFAULT_MAX_TODO_ITEMS
  // One emitter for the whole backlog, so ready-for-merge fires once across every item
  // and a session name only re-emits on an actual rename.
  const gateDeps = {
    requestChoice: opts.requestChoice,
    emit,
    signal: opts.signal,
    emitTurnSignals: createTurnSignalEmitter(emit),
  }

  let completed = 0
  let stalls = 0
  let file: string | undefined

  // The backlog emptied: announce it if we did any work, and report a clean finish.
  // Both the mid-loop find and the post-loop re-check funnel through here.
  const finishEmpty = (): TodoLoopResult => {
    if (completed > 0) emit({ kind: 'log', message: `Backlog done: ${file ?? 'TODO'} is empty after ${completed} item(s).` })
    return { completed, reason: 'empty', ...(file ? { file } : {}) }
  }

  for (let item = 0; item < maxItems; item++) {
    if (opts.signal?.aborted) break
    const backlog = await findTodoBacklog(cwd)
    if (!backlog) return finishEmpty()
    file = backlog.name
    const next = backlog.entries[0]!
    const preview = next.length > 100 ? `${next.slice(0, 100)}…` : next

    if (item === 0) emit({ kind: 'log', message: `Backlog: ${backlog.name} has ${backlog.entries.length} open item(s).` })

    // The per-item gate (#323): pause before starting a new entry when someone
    // can answer. Interactive-only, like the plan-approval gate — a headless run
    // emits no gate and just proceeds (autopilot semantics, budget-capped).
    if (opts.requestChoice) {
      const picked = await requestChoices({
        id: item === 0 ? 'todo-next' : `todo-next-${item}`,
        title: `Start the next backlog item? (${backlog.entries.length} open)`,
        options: [
          { id: 'proceed', label: `Work on: ${preview}` },
          { id: 'stop', label: 'Stop the backlog loop' },
        ],
        recommended: 'proceed',
        requestChoice: opts.requestChoice,
        emit,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      if (picked === 'stop') {
        emit({ kind: 'log', message: `Backlog loop stopped by you (${backlog.entries.length} item(s) left in ${backlog.name}).` })
        return { completed, reason: 'stopped', file }
      }
    }

    emit({ kind: 'log', message: `Backlog item ${completed + 1}: ${preview}` })
    // Complete exactly the first open entry and check it off, honoring await gates.
    // A declined plan (#358) ends the item turn; the loop's stall check takes it from there.
    const prompt = `Open \`${backlog.name}\` in the workspace and work on the FIRST open entry only. Complete it fully and verify your work. Then update \`${backlog.name}\`: check the entry off (or remove it). Do not start any other entry.`
    await runAwaitRounds({ session, prompt, ...gateDeps })
    completed++

    // Progress check: the item turn must have retired the entry it was given
    // (checked off, removed, or reworded). New entries appended by the work
    // (e.g. Maintenance follow-ups) are fine — only the *next* entry standing
    // still counts as a stall.
    const after = await findTodoBacklog(cwd)
    if (after && after.name === backlog.name && after.entries[0] === next) {
      stalls++
      if (stalls >= MAX_STALLS) {
        emit({ kind: 'log', message: `Backlog loop stopped: no progress on "${preview}" after ${MAX_STALLS} attempt(s).` })
        return { completed, reason: 'stalled', file }
      }
    } else {
      stalls = 0
    }
  }

  // Aborted mid-loop (Stop button / budget cap #322): the run is ending anyway,
  // so report a clean stop without extra narration.
  if (opts.signal?.aborted) return { completed, reason: 'stopped', ...(file ? { file } : {}) }

  const remaining = await findTodoBacklog(cwd)
  if (!remaining) return finishEmpty()
  emit({
    kind: 'log',
    message: `Backlog loop stopped at the ${maxItems}-item cap; ${remaining.entries.length} item(s) left in ${remaining.name}.`,
  })
  return { completed, reason: 'max-items', ...(file ? { file } : {}) }
}

