import { join } from 'node:path'
import type { FrameworkEvent } from '../events.js'
import { nodeFs } from '../node-fs.js'

/**
 * Persisted orchestration state (#211). The dashboard is a pure projection of the
 * {@link FrameworkEvent} stream, so persisting *is* durably logging that stream:
 * the stack rationale, the loop status, and the decisions ledger are all events
 * that already flow through it. We store the log append-only and rehydrate a
 * restarted dashboard by replaying it into a fresh stream — no separate state
 * model to keep in sync. Per the sync, we do **not** persist the agent's chat
 * transcript (Claude Code owns that); only our own orchestration events.
 */

/**
 * The directory, under the workspace root, that holds the persisted run. Same
 * `.the-framework/` directory as the committed project log (#313): one dir holds
 * both the transient run state (events.jsonl / run.json / runs/) and the DB
 * (LOGS.md); a seeded `.the-framework/.gitignore` keeps the run state untracked.
 */
export const FRAMEWORK_DIR = '.the-framework'

/** The append-only event log: one {@link FrameworkEvent} per line (JSONL). */
export const EVENTS_FILE = 'events.jsonl'

/** A small snapshot for cheap status reads without replaying the whole log. */
export const META_FILE = 'run.json'

/**
 * Where finished runs are archived, so the dashboard can list a project's run
 * history (#303). The live run stays at `events.jsonl`/`run.json` (the daemon
 * tails it); on {@link RunStore.close} a copy lands here as `<id>.jsonl` +
 * `<id>.json`, giving the history sidebar a per-run log to replay.
 */
export const RUNS_DIR = 'runs'

/** Filesystem-safe, lexicographically-sortable run id from an ISO start time. */
export function runIdFromStartedAt(startedAt: string): string {
  // ISO is fixed-width, so replacing the `:`/`.` separators keeps lexical order
  // in step with chronological order — the history list sorts by id alone.
  return startedAt.replace(/[:.]/g, '-')
}

/** A run id is path-safe: no separators or traversal, only our own charset. */
export function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** Bumped when the on-disk shape changes, so a reader can detect an old file. */
export const RUN_META_VERSION = 1

/** How a run ended (or that it is still going). */
export type RunStatus = 'running' | 'done' | 'stopped' | 'failed'

/**
 * A queryable snapshot of the run, derived entirely from the event log. Lets the
 * dashboard render a header (and a future run list) without parsing every line.
 */
export interface RunMeta {
  version: number
  status: RunStatus
  /** Stable, path-safe id for this run (derived from {@link startedAt}). */
  id: string
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
  /** The session name the agent chose (#326), also its `the-framework/<name>` branch. */
  sessionName?: string
  /** Whether the agent signalled `setReadyForMerge()` (#326): building (false/absent) vs ready (true). */
  readyForMerge?: boolean
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
  /** List a directory's entries (names only). Missing dir yields `[]`. */
  readdir(path: string): Promise<string[]>
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
    case 'session-name':
      next.sessionName = event.name
      break
    case 'ready-for-merge':
      next.readyForMerge = true
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
      next.status = event.ok ? 'done' : event.stopped ? 'stopped' : 'failed'
      break
    default:
      break
  }
  return next
}

/** Rebuild {@link RunMeta} from a full event log (used when resuming). */
export function metaFromEvents(events: readonly FrameworkEvent[], startedAt: string): RunMeta {
  let meta: RunMeta = {
    version: RUN_META_VERSION,
    status: 'running',
    id: runIdFromStartedAt(startedAt),
    startedAt,
    updatedAt: startedAt,
    passes: 0,
  }
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
   * Open (creating `.the-framework/` if needed) under the workspace `cwd`. `fresh`
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
      id: runIdFromStartedAt(now),
      startedAt: now,
      updatedAt: now,
      passes: 0,
    })
    if (opts.fresh) {
      // A new run truncates the live log. First rescue the prior run if it never
      // got archived (e.g. a crash exited before close), so no history is lost.
      await archivePriorRun(fs, dir).catch(() => {})
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

  /**
   * Flush any queued writes, then archive this run into `runs/` so it shows up in
   * the dashboard's history (#303). Both best-effort: persistence must never break
   * a run, so an archive failure is logged, not thrown.
   */
  async close(): Promise<void> {
    await this.tail
    try {
      await archiveRun(this.fs, this.dir, this.meta, this.eventsPath)
    } catch (err) {
      console.error('[framework] failed to archive run history:', err)
    }
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

/** Paths of a run's archived log + meta under `.the-framework/runs/`. */
function archivePaths(dir: string, id: string): { events: string; meta: string } {
  const runs = join(dir, RUNS_DIR)
  return { events: join(runs, `${id}.jsonl`), meta: join(runs, `${id}.json`) }
}

/**
 * Copy a run's live log + meta into `runs/<id>.jsonl` / `runs/<id>.json`. The live
 * files stay put (the daemon keeps tailing them until the next run); this is a
 * durable snapshot for the history list. Idempotent per id.
 */
async function archiveRun(fs: StoreFs, dir: string, meta: RunMeta, eventsPath: string): Promise<void> {
  if (!isSafeRunId(meta.id)) return
  await fs.mkdir(join(dir, RUNS_DIR))
  const out = archivePaths(dir, meta.id)
  const events = (await fs.exists(eventsPath)) ? await fs.read(eventsPath) : ''
  await fs.write(out.events, events)
  await fs.write(out.meta, JSON.stringify(meta, null, 2) + '\n')
}

/**
 * Archive the run currently sitting in the live files, unless it is already in
 * `runs/`. Used at the start of a fresh run so a crash that skipped
 * {@link RunStore.close} still leaves its history behind.
 */
async function archivePriorRun(fs: StoreFs, dir: string): Promise<void> {
  const metaPath = join(dir, META_FILE)
  if (!(await fs.exists(metaPath))) return
  let meta: RunMeta
  try {
    meta = JSON.parse(await fs.read(metaPath)) as RunMeta
  } catch {
    return
  }
  if (!meta?.id || !isSafeRunId(meta.id)) return
  if (await fs.exists(archivePaths(dir, meta.id).meta)) return
  await archiveRun(fs, dir, meta, join(dir, EVENTS_FILE))
}

/**
 * List a project's archived runs, most-recent first. Reads every `runs/*.json`
 * meta; the id sorts chronologically so no timestamp parse is needed. Missing or
 * unreadable dir/entries are skipped, never thrown.
 */
export async function listRuns(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<RunMeta[]> {
  const runsDir = join(cwd, FRAMEWORK_DIR, RUNS_DIR)
  const entries = await fs.readdir(runsDir)
  const metas: RunMeta[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      metas.push(JSON.parse(await fs.read(join(runsDir, name))) as RunMeta)
    } catch {
      // skip a torn/half-written meta
    }
  }
  return metas.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/**
 * The live (in-progress) run's meta snapshot from `.the-framework/run.json`, or
 * `undefined` when none/unreadable. Unlike {@link listRuns} (which reads the
 * archived `runs/` copies written on close), this is the run the daemon is
 * tailing right now — so the dashboard can list it with a `running` status
 * before it finishes. Missing or torn file yields `undefined`, never throws.
 */
export async function readLiveMeta(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<RunMeta | undefined> {
  const path = join(cwd, FRAMEWORK_DIR, META_FILE)
  if (!(await fs.exists(path))) return undefined
  try {
    return JSON.parse(await fs.read(path)) as RunMeta
  } catch {
    return undefined
  }
}

/**
 * Read one archived run's event log for replay. Returns `undefined` for an
 * unknown or unsafe id; a torn trailing line is dropped (same rule as the live
 * {@link RunStore.loadEvents}).
 */
export async function loadRunEvents(
  cwd: string,
  id: string,
  fs: StoreFs = nodeStoreFs(),
): Promise<FrameworkEvent[] | undefined> {
  if (!isSafeRunId(id)) return undefined
  const path = archivePaths(join(cwd, FRAMEWORK_DIR), id).events
  if (!(await fs.exists(path))) return undefined
  const events: FrameworkEvent[] = []
  for (const line of (await fs.read(path)).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as FrameworkEvent)
    } catch {
      break
    }
  }
  return events
}

/** A {@link StoreFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeStoreFs(): StoreFs {
  // Destructured rather than returned whole: the narrow interface is the contract,
  // so the object should not carry methods the store was never handed.
  const { read, write, append, exists, mkdir, readdir } = nodeFs()
  return { read, write, append, exists, mkdir, readdir }
}
