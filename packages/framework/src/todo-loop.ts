import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DriverSession } from './driver/index.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { requestChoices, resolveAwaitGate } from './run.js'
import { PLAN_DECLINED_MESSAGE, isDeclinedConfirmation, parseAwaitGate } from './turn-gate.js'

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

/** The session-scoped backlog filename the #326 prompt writes. */
export const TODO_FILE_PATTERN = /^TODO_[a-z0-9-]+\.agent\.md$/

/** The flat fallback the current pill (#301) still writes. */
export const FLAT_TODO_FILE = 'TODO.md'

/** A located backlog: its filename and the entries still open. */
export interface TodoBacklog {
  /** The backlog filename (workspace-root relative, e.g. `TODO_feat-x.agent.md`). */
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
 * Locate the workspace's backlog: the most recently modified session-scoped
 * `TODO_<slug>.agent.md` (#323/#326), falling back to the flat `TODO.md` the
 * current pill writes (#301) — the same dual convention as the doc sidebar.
 * Returns `undefined` when no backlog exists or none has open entries.
 */
export async function findTodoBacklog(cwd: string): Promise<TodoBacklog | undefined> {
  let names: string[]
  try {
    names = (await readdir(cwd, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name)
  } catch {
    return undefined
  }
  const scoped = names.filter(name => TODO_FILE_PATTERN.test(name))
  const candidates: string[] = []
  if (scoped.length > 1) {
    // More than one session's backlog: the newest is this run's.
    const withTimes = await Promise.all(
      scoped.map(async name => ({ name, mtime: (await stat(join(cwd, name)).catch(() => undefined))?.mtimeMs ?? 0 })),
    )
    candidates.push(...withTimes.sort((a, b) => b.mtime - a.mtime).map(e => e.name))
  } else {
    candidates.push(...scoped)
  }
  if (names.includes(FLAT_TODO_FILE)) candidates.push(FLAT_TODO_FILE)

  for (const name of candidates) {
    const md = await readFile(join(cwd, name), 'utf8').catch(() => undefined)
    if (md === undefined) continue
    const entries = parseTodoEntries(md)
    if (entries.length) return { name, entries }
  }
  return undefined
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
 * next entry untouched stop the loop instead of spinning. Await gates inside an
 * item turn (`showChoices()` / `showMultiSelect()`) are honored like anywhere else.
 */
export async function runTodoLoop(opts: TodoLoopOptions): Promise<TodoLoopResult> {
  const { session, cwd, emit } = opts
  const maxItems = opts.maxItems ?? DEFAULT_MAX_TODO_ITEMS
  const gateDeps = { requestChoice: opts.requestChoice, emit, signal: opts.signal }

  let completed = 0
  let stalls = 0
  let file: string | undefined

  for (let item = 0; item < maxItems; item++) {
    if (opts.signal?.aborted) break
    const backlog = await findTodoBacklog(cwd)
    if (!backlog) {
      if (completed > 0) emit({ kind: 'log', message: `Backlog done: ${file ?? 'TODO'} is empty after ${completed} item(s).` })
      return { completed, reason: 'empty', ...(file ? { file } : {}) }
    }
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
    await promptItem(session, backlog.name, gateDeps)
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
  if (!remaining) {
    if (completed > 0) emit({ kind: 'log', message: `Backlog done: ${file ?? 'TODO'} is empty after ${completed} item(s).` })
    return { completed, reason: 'empty', ...(file ? { file } : {}) }
  }
  emit({
    kind: 'log',
    message: `Backlog loop stopped at the ${maxItems}-item cap; ${remaining.entries.length} item(s) left in ${remaining.name}.`,
  })
  return { completed, reason: 'max-items', ...(file ? { file } : {}) }
}

/** How many times one backlog item may stop to ask before the turn just finishes. */
const MAX_AWAIT_ROUNDS = 5

/** One backlog item's turn: complete the first open entry, honoring await gates. */
async function promptItem(
  session: DriverSession,
  fileName: string,
  deps: {
    requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
    emit: (event: FrameworkEvent) => void
    signal?: AbortSignal | undefined
  },
): Promise<void> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  const prompt = `Open \`${fileName}\` at the workspace root and work on the FIRST open entry only. Complete it fully and verify your work. Then update \`${fileName}\`: check the entry off (or remove it). Do not start any other entry.`
  let turn = await session.prompt(prompt, signalOpt)
  let gate = parseAwaitGate(turn.text)
  for (let round = 0; round < MAX_AWAIT_ROUNDS && gate; round++) {
    const answer = await resolveAwaitGate(gate, round, deps)
    if (isDeclinedConfirmation(gate, answer)) {
      // A declined plan (#358) ends the item turn; the loop's stall check takes it from there.
      deps.emit({ kind: 'log', message: PLAN_DECLINED_MESSAGE })
      return
    }
    deps.emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
    turn = await session.prompt(
      `You paused to ask: "${gate.title}". The user chose: ${answer}. Continue the backlog entry with that decision, and do not ask again unless a genuinely new choice comes up.`,
      signalOpt,
    )
    gate = parseAwaitGate(turn.text)
  }
}
