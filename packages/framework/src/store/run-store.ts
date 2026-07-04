import { join } from 'node:path'
import type { FrameworkEvent } from '../events.js'

/**
 * Persisted orchestration state (#211). The dashboard is a pure projection of the
 * {@link FrameworkEvent} stream, so persisting *is* durably logging that stream:
 * the stack rationale, the loop status, and the decisions ledger are all events
 * that already flow through it. We store the log append-only and rehydrate a
 * restarted dashboard by replaying it into a fresh stream — no separate state
 * model to keep in sync. Per the sync, we do **not** persist the agent's chat
 * transcript (Claude Code owns that); only our own orchestration events.
 */

/** The directory, under the workspace root, that holds the persisted run. */
export const FRAMEWORK_DIR = '.framework'

/** The append-only event log: one {@link FrameworkEvent} per line (JSONL). */
export const EVENTS_FILE = 'events.jsonl'

/** A small snapshot for cheap status reads without replaying the whole log. */
export const META_FILE = 'run.json'

/** Bumped when the on-disk shape changes, so a reader can detect an old file. */
export const RUN_META_VERSION = 1

/** How a run ended (or that it is still going). */
export type RunStatus = 'running' | 'done' | 'failed'

/**
 * A queryable snapshot of the run, derived entirely from the event log. Lets the
 * dashboard render a header (and a future run list) without parsing every line.
 */
export interface RunMeta {
  version: number
  status: RunStatus
  /** ISO timestamp the store was opened (run start). */
  startedAt: string
  /** ISO timestamp of the last event written. */
  updatedAt: string
  /** Full-fledged loop passes performed so far. */
  passes: number
  /** What the user asked to build (from the `scope` event). */
  intent?: string
  scope?: string
  /** The wrapped agent (from the `session` event). */
  driver?: string
  /** The workspace the agent builds in (from the `session` event). */
  workspace?: string
  /** The wrapped agent's real session id, once it reports one. */
  sessionId?: string
  /** The link shown to jump into the live agent session. */
  sessionLink?: string
}

/**
 * The slice of a filesystem {@link RunStore} needs. Mirrors the `LedgerFs` seam
 * in ai-autopilot's decisions store: the store logic is pure and testable with an
 * in-memory fs, and only {@link nodeStoreFs} touches disk.
 */
export interface StoreFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  append(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
}

/** Options for {@link RunStore.open}. */
export interface OpenStoreOptions {
  /** The filesystem adapter. Default {@link nodeStoreFs}. */
  fs?: StoreFs
  /**
   * Truncate any prior log so this is a clean run (MVP: one run per workspace).
   * `false` (the default) opens read-only-ish for {@link RunStore.loadEvents} —
   * the `--resume` path — and does not clear the log.
   */
  fresh?: boolean
  /** The wall-clock start, ISO. Injectable so tests are deterministic. */
  now?: string
}

/**
 * Fold one event into the running {@link RunMeta}. Pure, so the same derivation
 * drives both a live append and reconstructing meta from a replayed log.
 */
export function applyEventToMeta(meta: RunMeta, event: FrameworkEvent, at: string): RunMeta {
  const next: RunMeta = { ...meta, updatedAt: at }
  switch (event.kind) {
    case 'session':
      next.driver = event.driver
      next.workspace = event.workspace
      if (event.sessionLink) next.sessionLink = event.sessionLink
      break
    case 'session-update':
      next.sessionId = event.sessionId
      if (event.sessionLink) next.sessionLink = event.sessionLink
      break
    case 'bootstrap': {
      const b = event.event
      if (b.type === 'scope') {
        next.intent = b.intent
        next.scope = b.scope
      } else if (b.type === 'checklist') {
        next.passes = b.pass
      } else if (b.type === 'done') {
        next.passes = b.result.passes
      }
      break
    }
    case 'end':
      next.status = event.ok ? 'done' : 'failed'
      break
    default:
      break
  }
  return next
}

/** Rebuild {@link RunMeta} from a full event log (used when resuming). */
export function metaFromEvents(events: readonly FrameworkEvent[], startedAt: string): RunMeta {
  let meta: RunMeta = { version: RUN_META_VERSION, status: 'running', startedAt, updatedAt: startedAt, passes: 0 }
  for (const event of events) meta = applyEventToMeta(meta, event, startedAt)
  return meta
}

/**
 * Durable, append-only store for a single run's orchestration events, plus a
 * derived {@link RunMeta} snapshot. Writes are serialized through one tail
 * promise so an append and its meta rewrite never interleave; {@link close}
 * flushes that queue before the process exits.
 */
export class RunStore {
  private tail: Promise<void> = Promise.resolve()
  private meta: RunMeta

  private constructor(
    private readonly fs: StoreFs,
    readonly dir: string,
    private readonly now: string,
    startMeta: RunMeta,
  ) {
    this.meta = startMeta
  }

  /** The event log path. */
  get eventsPath(): string {
    return join(this.dir, EVENTS_FILE)
  }

  /** The meta snapshot path. */
  get metaPath(): string {
    return join(this.dir, META_FILE)
  }

  /**
   * Open (creating `.framework/` if needed) under the workspace `cwd`. `fresh`
   * truncates any prior log for a new run; the default preserves it so a resume
   * can {@link loadEvents}.
   */
  static async open(cwd: string, opts: OpenStoreOptions = {}): Promise<RunStore> {
    const fs = opts.fs ?? nodeStoreFs()
    const dir = join(cwd, FRAMEWORK_DIR)
    const now = opts.now ?? new Date().toISOString()
    await fs.mkdir(dir)
    const store = new RunStore(fs, dir, now, {
      version: RUN_META_VERSION,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      passes: 0,
    })
    if (opts.fresh) {
      await fs.write(store.eventsPath, '')
      await store.writeMeta()
    }
    return store
  }

  /**
   * Append one event to the log and refresh the meta snapshot. Fire-and-forget at
   * the call site: internally chained so writes stay ordered. A failed write is
   * swallowed (persistence is best-effort — it must never break a live run).
   */
  append(event: FrameworkEvent): Promise<void> {
    this.meta = applyEventToMeta(this.meta, event, this.now)
    this.tail = this.tail
      .then(() => this.fs.append(this.eventsPath, JSON.stringify(event) + '\n'))
      .then(() => this.writeMeta())
      .catch(err => {
        console.error('[framework] failed to persist orchestration state:', err)
      })
    return this.tail
  }

  /** Flush any queued writes. Call before exit so the log is complete on disk. */
  async close(): Promise<void> {
    await this.tail
  }

  /** The current derived snapshot. */
  snapshot(): RunMeta {
    return { ...this.meta }
  }

  /**
   * Read and parse the persisted event log. A blank or malformed trailing line
   * (e.g. a crash mid-write) is skipped rather than throwing, so a partial run
   * still replays everything up to the cut. Missing file yields `[]`.
   */
  async loadEvents(): Promise<FrameworkEvent[]> {
    if (!(await this.fs.exists(this.eventsPath))) return []
    const raw = await this.fs.read(this.eventsPath)
    const events: FrameworkEvent[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as FrameworkEvent)
      } catch {
        // A torn last line from an interrupted write; stop, keep what we have.
        break
      }
    }
    return events
  }

  /** Read the persisted meta snapshot, or `undefined` if none/unreadable. */
  async readMeta(): Promise<RunMeta | undefined> {
    if (!(await this.fs.exists(this.metaPath))) return undefined
    try {
      return JSON.parse(await this.fs.read(this.metaPath)) as RunMeta
    } catch {
      return undefined
    }
  }

  private writeMeta(): Promise<void> {
    return this.fs.write(this.metaPath, JSON.stringify(this.meta, null, 2) + '\n')
  }
}

/**
 * A {@link StoreFs} backed by `node:fs/promises`. The import is dynamic so the
 * store core stays free of a hard `node:fs` dependency — same convention as
 * ai-autopilot's `nodeLedgerFs`.
 */
export function nodeStoreFs(): StoreFs {
  return {
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8')
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, contents, 'utf8')
    },
    async append(path, contents) {
      const { appendFile } = await import('node:fs/promises')
      await appendFile(path, contents, 'utf8')
    },
    async exists(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
    async mkdir(path) {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(path, { recursive: true })
    },
  }
}
