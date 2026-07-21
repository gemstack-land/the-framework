import { join } from 'node:path'
import { hostname } from 'node:os'
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

/**
 * Per-run worktrees live under `<repo>/.the-framework/worktrees/` (#736). Kept out of git by
 * the install-time `.the-framework/.gitignore` (`*` rule, #313), so a worktree's checkout never
 * shows up as dirty in the parent. Declared here beside {@link FRAMEWORK_DIR} rather than in
 * `worktree.ts`, which imports from this module: {@link readLiveMetas} needs it to find the
 * runs living in those worktrees, and the other direction would be an import cycle.
 */
export const WORKTREES_DIR = 'worktrees'

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
  /**
   * The OS pid of the process that owns this run (the one tailing `control.jsonl`), on {@link host}.
   * Persisted so a reader can tell a live run from one whose process died without writing `end`
   * (#716): a `running` meta whose owning pid is gone is stale and gets flipped to `stopped`.
   */
  pid?: number
  /** The host the owning {@link pid} lives on, so a pid probe only trusts a match (#716). */
  host?: string
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
  /**
   * The branch the run's work landed on, recorded while its worktree still exists (#799).
   *
   * Not reliably derivable afterwards: a clean run loses its checkout, and the #326 prompt lets
   * the agent create its own branch, so neither `the-framework/<sessionName>` nor the run-id
   * branch is guaranteed to be the one holding the commits.
   */
  branch?: string
  /** Whether the agent signalled `setReadyForMerge()` (#326): building (false/absent) vs ready (true). */
  readyForMerge?: boolean
  /**
   * The choice gate the run is currently parked on (#636): set when a `choice` event fires and
   * cleared when its `choice-resolved` (or the run's `end`) arrives. Present means the run is
   * paused waiting for the user's answer — the second "needs you" source after open PRs (#624).
   */
  pendingChoice?: { id: string; title: string }
  /**
   * When the run settled and parked on the user (#785), or absent while the agent is working.
   *
   * Deliberately not a {@link RunStatus} value: the run IS still live while it waits (its
   * process is alive, it still takes messages, it still holds the project), and a dozen readers
   * key "live" off `status === 'running'`. This is the orthogonal fact — working, or waiting on
   * you — which `status` cannot carry because it only changes when the run ends.
   */
  settledAt?: string
  /**
   * The loopback port the run's browser preview is listening on (#813), or absent when the run
   * has no browser. What lets the daemon proxy the pane: the port is allocated per run and the
   * dashboard is a different process, so meta is the only place it can learn it.
   */
  browserStreamPort?: number
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
  /**
   * Reads the current time for each appended event, so {@link RunMeta.updatedAt} tracks the last
   * event rather than the run's start. Injectable so tests can step it deterministically.
   *
   * Separate from {@link now} on purpose: `now` is when the run *opened*, and a single timestamp
   * cannot answer both questions. Reusing it for appends froze `updatedAt` at `startedAt` for a
   * run's whole life, which every reader that orders by recency (the overview, the activity feed,
   * the interventions queue) silently sorted on.
   */
  clock?: () => string
  /**
   * The run's intent (its prompt / request) shown in the dashboard's Runs list. A build run
   * later refines this via its `bootstrap` scope event; a `prompt`/`research` run has no scope
   * step, so seeding it here is the only way its row shows the prompt instead of "(no prompt)".
   */
  intent?: string
  /**
   * Who owns this run (#716). Defaults to the current process on this host — the process opening a
   * fresh store *is* the run's owner. Injectable so tests can seed a specific (dead) pid.
   */
  owner?: RunOwner
  /**
   * The run's id, overriding the one derived from {@link OpenStoreOptions.now}. The daemon
   * allocates the id before it spawns the run (it names the run's worktree with it, #736) and
   * passes it in, so the worktree directory and the run inside it are one string rather than two
   * timestamps taken a moment apart. Ignored unless path-safe.
   */
  id?: string
  /**
   * Reopen the run already at this path instead of starting a new one (#762): keep its event log
   * and its original intent, and flip it back to `running` under this process. What makes a
   * continued run one row in the history rather than two: the follow-up is a second process, but
   * it writes into the same run.
   *
   * Falls back to a fresh run when there is nothing to reopen.
   */
  continueRun?: boolean
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
    case 'choice':
      next.pendingChoice = { id: event.id, title: event.title }
      break
    case 'choice-resolved':
      if (next.pendingChoice?.id === event.id) delete next.pendingChoice
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
    case 'browser-stream':
      next.browserStreamPort = event.port
      break
    case 'settled':
      next.settledAt = at
      break
    case 'driver':
      // Any new turn means the agent is working again, so the run is no longer parked (#785).
      if (event.event.type === 'start') delete next.settledAt
      break
    case 'end':
      next.status = event.ok ? 'done' : event.stopped ? 'stopped' : 'failed'
      delete next.pendingChoice // a finished run is not awaiting anything
      delete next.settledAt // nor is it waiting on you
      // The bridge dies with the run, so a kept port would send the pane at whatever else
      // the OS handed that number next.
      delete next.browserStreamPort
      break
    default:
      break
  }
  return next
}

/** Who owns a live run: its OS pid and the host that pid lives on (#716). */
export interface RunOwner {
  pid: number
  host: string
}

/** The seed meta a run starts from, before any event is folded in. */
function freshMeta(startedAt: string, intent?: string, owner?: RunOwner, id?: string): RunMeta {
  return {
    version: RUN_META_VERSION,
    status: 'running',
    id: id && isSafeRunId(id) ? id : runIdFromStartedAt(startedAt),
    startedAt,
    updatedAt: startedAt,
    passes: 0,
    ...(owner ? { pid: owner.pid, host: owner.host } : {}),
    ...(intent ? { intent } : {}),
  }
}

/**
 * Parse a JSONL event log. A blank or malformed trailing line (e.g. a crash
 * mid-write) stops the read rather than throwing, so a partial run still replays
 * everything up to the cut.
 */
function parseEventLog(raw: string): FrameworkEvent[] {
  const events: FrameworkEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as FrameworkEvent)
    } catch {
      break // a torn last line from an interrupted write; keep what we have
    }
  }
  return events
}

/** Read + parse a persisted {@link RunMeta} file, or `undefined` if missing/unreadable. */
async function readMetaFile(fs: StoreFs, path: string): Promise<RunMeta | undefined> {
  if (!(await fs.exists(path))) return undefined
  try {
    return JSON.parse(await fs.read(path)) as RunMeta
  } catch {
    return undefined
  }
}

/** Write a {@link RunMeta} file. The one owner of the on-disk encoding, symmetric to
 * {@link readMetaFile} — every meta write in this module goes through it. */
function writeMetaFile(fs: StoreFs, path: string, meta: RunMeta): Promise<void> {
  return fs.write(path, JSON.stringify(meta, null, 2) + '\n')
}

/**
 * Flip the live run at `dir` to `stopped` and archive it, returning the stopped meta. The
 * shared tail of every self-heal: a `running` meta whose process is gone must both stop
 * showing as live and keep its history. Best-effort on both writes — healing must never
 * make a read throw.
 */
async function stopAndArchiveLive(fs: StoreFs, dir: string, meta: RunMeta): Promise<RunMeta> {
  const stopped: RunMeta = { ...meta, status: 'stopped' }
  await writeMetaFile(fs, join(dir, META_FILE), stopped).catch(() => {})
  await archivePriorRun(fs, dir).catch(() => {})
  return stopped
}

/** Rebuild {@link RunMeta} from a full event log (used when resuming). */
export function metaFromEvents(events: readonly FrameworkEvent[], startedAt: string): RunMeta {
  let meta = freshMeta(startedAt)
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
    private readonly clock: () => string,
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
    const owner = opts.owner ?? { pid: process.pid, host: hostname() }
    const clock = opts.clock ?? (() => new Date().toISOString())
    const store = new RunStore(fs, dir, clock, freshMeta(now, opts.intent, owner, opts.id))
    if (opts.continueRun) {
      // Reopen: the log stays, the row keeps its original intent, and this process takes ownership
      // so a liveness probe (#716) reads the run as alive rather than as an orphan.
      const prior = await readMetaFile(fs, store.metaPath)
      if (prior) {
        store.meta = { ...prior, status: 'running', pid: owner.pid, host: owner.host, updatedAt: now }
        await store.writeMeta()
        return store
      }
    }
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
    this.meta = applyEventToMeta(this.meta, event, this.clock())
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
    return parseEventLog(await this.fs.read(this.eventsPath))
  }

  /** Read the persisted meta snapshot, or `undefined` if none/unreadable. */
  readMeta(): Promise<RunMeta | undefined> {
    return readMetaFile(this.fs, this.metaPath)
  }

  private writeMeta(): Promise<void> {
    return writeMetaFile(this.fs, this.metaPath, this.meta)
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
  await writeMetaFile(fs, out.meta, meta)
}

/**
 * Archive the run currently sitting in the live files, unless it is already in
 * `runs/`. Used at the start of a fresh run so a crash that skipped
 * {@link RunStore.close} still leaves its history behind.
 */
async function archivePriorRun(fs: StoreFs, dir: string): Promise<void> {
  const meta = await readMetaFile(fs, join(dir, META_FILE))
  if (!meta?.id || !isSafeRunId(meta.id)) return
  if (await fs.exists(archivePaths(dir, meta.id).meta)) return
  await archiveRun(fs, dir, meta, join(dir, EVENTS_FILE))
}

/**
 * Put an archived run's history back where a run reads it (#762), so a continued run picks up its
 * own log rather than starting empty. The inverse of {@link archiveWorktreeRun}: teardown moved the
 * history to the repo, and continuing needs it in the checkout again.
 *
 * A no-op when the worktree already holds a live run (nothing to restore, and its log is newer),
 * or when there is no archive. Never throws.
 */
export async function restoreArchivedRun(
  repo: string,
  worktree: string,
  runId: string,
  fs: StoreFs = nodeStoreFs(),
): Promise<boolean> {
  try {
    if (!isSafeRunId(runId)) return false
    const dir = join(worktree, FRAMEWORK_DIR)
    if (await fs.exists(join(dir, META_FILE))) return false
    const archive = archivePaths(join(repo, FRAMEWORK_DIR), runId)
    if (!(await fs.exists(archive.meta))) return false
    await fs.mkdir(dir)
    await fs.write(join(dir, EVENTS_FILE), (await fs.exists(archive.events)) ? await fs.read(archive.events) : '')
    await fs.write(join(dir, META_FILE), await fs.read(archive.meta))
    return true
  } catch {
    return false
  }
}

/**
 * The run ids that have a worktree directory under `.the-framework/worktrees/` (#737). Names
 * only, from the filesystem: a directory here IS a run's checkout, and its name is the run id.
 * Forgiving — a project that never ran concurrently has no such dir and yields `[]`.
 */
export async function listWorktreeDirs(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<string[]> {
  const names = await fs.readdir(join(cwd, FRAMEWORK_DIR, WORKTREES_DIR)).catch(() => [])
  return names.filter(isSafeRunId)
}

/**
 * Archive a worktree run's history into the *main repo* (#737), returning the meta it archived.
 *
 * A run writes its `run.json` / `events.jsonl` inside its own worktree (#736), so deleting that
 * worktree would delete the run's history with it. This copies it to the repo's `runs/`, which is
 * the one place the dashboard's history reads from, so teardown becomes safe.
 *
 * A meta still marked `running` is flipped to `stopped` first: this runs when the process is
 * already gone, so `running` means it died without closing (crash, kill -9), exactly the case
 * {@link reconcileOrphanedRuns} handles for the project path. Idempotent per id, and forgiving:
 * a worktree with no run, or an unreadable one, yields `undefined` rather than throwing.
 */
export async function archiveWorktreeRun(
  worktree: string,
  repo: string,
  fs: StoreFs = nodeStoreFs(),
  branch?: string,
): Promise<RunMeta | undefined> {
  try {
    const worktreeDir = join(worktree, FRAMEWORK_DIR)
    const live = await readMetaFile(fs, join(worktreeDir, META_FILE))
    if (!live?.id || !isSafeRunId(live.id)) return undefined
    const stopped: RunMeta = live.status === 'running' ? { ...live, status: 'stopped' } : live
    // The branch is read from the checkout by the caller and stamped here, because this is the
    // last moment it can be observed: the worktree is about to go (#799).
    const meta: RunMeta = branch ? { ...stopped, branch } : stopped
    await archiveRun(fs, join(repo, FRAMEWORK_DIR), meta, join(worktreeDir, EVENTS_FILE))
    return meta
  } catch {
    return undefined
  }
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
 * Whether a `running` meta's owning process is provably there, provably gone, or unknowable.
 *
 * `'unknown'` is the load-bearing third state (#716/#926): a meta with no `pid` (it predates the
 * field) or one owned by another host cannot be probed from here. The two callers treat it
 * differently on purpose — the boot reconcile flips an unknown to `stopped` (a fresh daemon
 * drives no in-flight run, and there is nothing better to go on), while the self-heal on read
 * leaves it alone (a routine read must not kill a run another machine may own).
 */
function ownerLiveness(meta: RunMeta, isAlive: (pid: number) => boolean): 'live' | 'dead' | 'unknown' {
  if (meta.status !== 'running' || meta.pid === undefined || meta.host !== hostname()) return 'unknown'
  return isAlive(meta.pid) ? 'live' : 'dead'
}

/**
 * Reconcile runs a dead process left marked `running` — the live `run.json`, an archived
 * `runs/*.json`, or a run inside a worktree. Such a run shows as active while nothing is left
 * to read its `control.jsonl`, so its Stop is a no-op. Each is flipped to `stopped`; the live
 * run is archived first (idempotent) so its history is kept. Returns how many were reconciled.
 * Best-effort: a read/write error skips that run, never throws.
 *
 * A run whose pid is alive on this host is left alone (#926). This used to flip every `running`
 * meta on the assumption that a fresh daemon drives no in-flight run, which holds only while
 * exactly one daemon ever boots: a second one (and before #922, every failed `framework --daemon`
 * spawned one) marked genuinely live runs as finished, giving them a no-op Stop in the dashboard.
 * A meta with no `pid` keeps the old behaviour, since there is nothing better to go on.
 */
export async function reconcileOrphanedRuns(
  cwd: string,
  fs: StoreFs = nodeStoreFs(),
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<number> {
  const dir = join(cwd, FRAMEWORK_DIR)
  let fixed = 0
  // Archived runs stuck at `running` (e.g. a prior live run the next run never
  // rescued). Done before the live run so its fresh archive isn't re-counted here.
  for (const name of await fs.readdir(join(dir, RUNS_DIR))) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, RUNS_DIR, name)
    try {
      const meta = JSON.parse(await fs.read(path)) as RunMeta
      if (meta.status !== 'running' || ownerLiveness(meta, isAlive) === 'live') continue
      await writeMetaFile(fs, path, { ...meta, status: 'stopped' })
      fixed++
    } catch {
      // torn/half-written meta — skip it
    }
  }
  // The live run: flip it, then archive so a crash that skipped close() still
  // leaves the stopped run in the history list.
  const live = await readMetaFile(fs, join(dir, META_FILE))
  if (live?.status === 'running' && ownerLiveness(live, isAlive) !== 'live') {
    await stopAndArchiveLive(fs, dir, live)
    fixed++
  }

  // Runs living in worktrees (#736/#737). A daemon that died mid-run never ran its teardown, so
  // each of those runs is orphaned the same way — except its history sits inside the worktree,
  // where nothing reads it. Flip it in place (so the dashboard stops showing it as live) and copy
  // it into the repo's history. The worktree itself is left on disk: a run that ended this way did
  // not end cleanly, and those are kept for inspection. Removing one is an explicit action.
  for (const name of await fs.readdir(join(dir, WORKTREES_DIR))) {
    if (!isSafeRunId(name)) continue
    const worktreeDir = join(dir, WORKTREES_DIR, name, FRAMEWORK_DIR)
    const meta = await readMetaFile(fs, join(worktreeDir, META_FILE))
    if (meta?.status !== 'running' || ownerLiveness(meta, isAlive) === 'live') continue
    await writeMetaFile(fs, join(worktreeDir, META_FILE), { ...meta, status: 'stopped' }).catch(() => {})
    await archiveWorktreeRun(join(dir, WORKTREES_DIR, name), cwd, fs).catch(() => undefined)
    fixed++
  }
  return fixed
}

/**
 * Whether `pid` is a live process on this host. `process.kill(pid, 0)` sends no signal but
 * throws `ESRCH` once the process is gone; `EPERM` means it exists under another user (still
 * alive). A pid on a *different* host is unknowable here, so callers guard on {@link RunMeta.host}
 * before trusting a result. A recycled pid (another process reusing a dead run's number) reads as
 * alive — an accepted, vanishingly rare miss on a single dev box.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The live (in-progress) run's meta snapshot from `.the-framework/run.json`, or
 * `undefined` when none/unreadable. Unlike {@link listRuns} (which reads the
 * archived `runs/` copies written on close), this is the run the daemon is
 * tailing right now — so the dashboard can list it with a `running` status
 * before it finishes. Missing or torn file yields `undefined`, never throws.
 *
 * Self-heals a stale run on read (#716): if the meta says `running` but its owning process died
 * without writing `end` (a crash, `kill -9`, or the machine sleeping), nothing is left to consume
 * `control.jsonl` — so Stop is a no-op and the row is stuck. When the owning pid is gone on this
 * host, flip it to `stopped` and archive it, so the dashboard clears the row on the next poll
 * instead of only after a daemon restart's boot-time {@link reconcileOrphanedRuns}. A run whose
 * meta predates this field (no `pid`) is left untouched — the boot reconcile still catches it.
 */
export async function readLiveMeta(
  cwd: string,
  fs: StoreFs = nodeStoreFs(),
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<RunMeta | undefined> {
  const dir = join(cwd, FRAMEWORK_DIR)
  const meta = await readMetaFile(fs, join(dir, META_FILE))
  if (!meta) return undefined
  // Only a provably dead owner heals here — 'unknown' (no pid / another host) is left alone.
  if (ownerLiveness(meta, isAlive) === 'dead') return stopAndArchiveLive(fs, dir, meta)
  return meta
}

/**
 * A live run plus the checkout it is running in (#738). Since #736 a run lives in its own
 * worktree, so a project's live run is no longer a single thing and no longer sits at the
 * project path: `cwd` says which checkout to read that run's git/file status from.
 */
export interface LiveRun extends RunMeta {
  /** The run's own checkout: a worktree under `.the-framework/worktrees/`, or the repo root. */
  cwd: string
}

/**
 * Every live run of a project (#738): the list variant of {@link readLiveMeta}.
 *
 * A run started from the dashboard gets its own worktree (#736) and writes its `run.json`
 * inside it, so the project path alone no longer sees any of them. This looks in both places:
 * each `.the-framework/worktrees/*` checkout, and the repo root itself, which is where a
 * project that cannot be given a worktree (not a git repo) still runs and where every run
 * from before #736 lives.
 *
 * Each candidate goes through {@link readLiveMeta}, so a stale run self-heals exactly as it
 * did. Newest first, by id. Never throws: an unreadable worktree is skipped.
 */
export async function readLiveMetas(
  cwd: string,
  fs: StoreFs = nodeStoreFs(),
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<LiveRun[]> {
  const worktreesDir = join(cwd, FRAMEWORK_DIR, WORKTREES_DIR)
  const names = await fs.readdir(worktreesDir).catch(() => [])
  // isSafeRunId: the directory name is the run id, and anything else in there is not ours.
  const candidates = [cwd, ...names.filter(isSafeRunId).map(name => join(worktreesDir, name))]
  const runs: LiveRun[] = []
  for (const candidate of candidates) {
    const meta = await readLiveMeta(candidate, fs, isAlive).catch(() => undefined)
    if (meta) runs.push({ ...meta, cwd: candidate })
  }
  return runs.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
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
  return parseEventLog(await fs.read(path))
}

/** A {@link StoreFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeStoreFs(): StoreFs {
  // Destructured rather than returned whole: the narrow interface is the contract,
  // so the object should not carry methods the store was never handed.
  const { read, write, append, exists, mkdir, readdir } = nodeFs()
  return { read, write, append, exists, mkdir, readdir }
}

/**
 * A project's runs: the live ones prepended to the archived history, newest-first. Forgiving —
 * a side that cannot be read simply contributes nothing.
 *
 * Live wins over archived (#768). The dedup used to drop the live copy, which was right while
 * "archived" meant "finished for good": a run was only ever copied into `runs/` on its way out.
 * Continuing a run (#762) breaks that — the run has an archived copy from its first leg AND is
 * live again — and keeping the archive showed a running run as finished.
 *
 * This composition, not its two halves, is what every caller actually wants; the store exporting
 * only the halves is why three separate modules each grew their own copy of it.
 */
export async function readAllRuns(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<RunMeta[]> {
  const [archived, live] = await Promise.all([
    listRuns(cwd, fs).catch(() => [] as RunMeta[]),
    readLiveMetas(cwd, fs).catch(() => [] as LiveRun[]),
  ])
  return [...live, ...archived.filter(run => !live.some(l => l.id === run.id))]
}

/**
 * One run's meta by id, live copy winning over archived — {@link readAllRuns}'s rule for a
 * single row. The find-by-id shape the RPCs kept privately rebuilding, for the same reason
 * the list shape did: the store exported only the halves.
 */
export async function findRun(cwd: string, runId: string, fs: StoreFs = nodeStoreFs()): Promise<RunMeta | undefined> {
  return (await readAllRuns(cwd, fs)).find(run => run.id === runId)
}

/**
 * Read a checkout's live event log (`.the-framework/events.jsonl`). Missing or unreadable
 * yields `[]`, and a torn trailing line is dropped — the same rule as
 * {@link RunStore.loadEvents}, exported so a reader outside the store (the Discord bot's gate
 * lookup) cannot keep a second parser with a drifted torn-line policy.
 */
export async function readEventLog(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<FrameworkEvent[]> {
  const path = join(cwd, FRAMEWORK_DIR, EVENTS_FILE)
  try {
    if (!(await fs.exists(path))) return []
    return parseEventLog(await fs.read(path))
  } catch {
    return []
  }
}
