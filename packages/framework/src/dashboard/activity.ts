import { listRuns, readLiveMetas, type LiveRun, type RunMeta, type RunStatus } from '../store/index.js'
import type { ProjectSummary } from './projects.js'

// The "New activity" feed (#627): the cross-project stream of run lifecycle transitions that
// do NOT need the human — a run started, a run finished. It is the default-off notification
// category, the counterpart to the interventions queue (which is the always-on "needs you"
// half). Same shape and same "only genuinely new" diff as interventions.ts, so the browser
// hook and the Discord watcher fold it into a baseline on first look and then notify once per
// transition — you hear a run kick off and a run land, nothing when the page/daemon starts.

/** How many recent runs per project to consider. Bounds the finished-set — older runs rolled off
 * long ago and were already baselined, so they never fire. A running run is always newest (live
 * meta is prepended), so it is always in range. */
const RECENT_RUNS = 20

/**
 * One run lifecycle event worth a passing mention. Two kinds: a run `started` (entered
 * `running`) or `finished` (reached a terminal status). The card is not shown for these — they
 * only drive notifications — so the fields are just what a notification line needs.
 */
export interface Activity {
  projectId: string
  projectName: string
  /** The run this is about. */
  runId: string
  /** `started` = the run entered `running`; `finished` = it reached a terminal status. */
  kind: 'started' | 'finished'
  /** What the run is building (its `intent`), for the notification body; may be absent. */
  title?: string
  /** The finished run's terminal status (`finished` only), so a stop reads differently from a done. */
  status?: RunStatus
  /** When the run last changed, ISO, for ordering and the baseline diff. */
  updatedAt?: string
}

/** Injectable seam so {@link buildActivity} is unit-testable off disk. */
export interface ActivityDeps {
  /** A project's runs, live prepended to the archived history, newest-first. Defaults to disk. */
  readRuns?: (cwd: string) => Promise<RunMeta[]>
}

/** A project's runs, live prepended to the archived history. Forgiving: a failed read is `[]`. */
async function readAllRuns(cwd: string): Promise<RunMeta[]> {
  const [archived, live] = await Promise.all([
    listRuns(cwd).catch(() => [] as RunMeta[]),
    readLiveMetas(cwd).catch(() => [] as LiveRun[]),
  ])
  // Skip a live run already archived under the same id, so it is not counted twice.
  // Live wins over archived (#768). The dedup used to drop the live copy, which was right while
  // "archived" meant "finished for good": a run was only ever copied into `runs/` on its way out.
  // Continuing a run (#762) breaks that — the run has an archived copy from its first leg AND is
  // live again — and keeping the archive showed a running run as finished.
  return [...live, ...archived.filter(run => !live.some(l => l.id === run.id))]
}

/** Map one run to its current activity item: `started` while running, else `finished`. */
function activityFor(project: ProjectSummary, run: RunMeta): Activity {
  const kind = run.status === 'running' ? 'started' : 'finished'
  return {
    projectId: project.id,
    projectName: project.name,
    runId: run.id,
    kind,
    ...(run.intent ? { title: run.intent } : {}),
    ...(kind === 'finished' ? { status: run.status } : {}),
    ...(run.updatedAt ? { updatedAt: run.updatedAt } : {}),
  }
}

/**
 * Build the cross-project activity feed: for each registered project's most recent runs, one
 * item per run reflecting where it is now (`started` while it runs, `finished` once it lands),
 * newest first. Forgiving — a project whose runs cannot be read simply contributes nothing.
 *
 * The `started` and `finished` items for one run carry distinct keys ({@link activityKey}), so a
 * run that is still going notifies once (started) and again when it lands (finished). A run that
 * both starts and finishes between two polls is only ever seen terminal, so it notifies once
 * (finished) — one quick run, one line.
 */
export async function buildActivity(projects: ProjectSummary[], deps: ActivityDeps = {}): Promise<Activity[]> {
  const readRuns = deps.readRuns ?? readAllRuns
  const items: Activity[] = []
  for (const project of projects) {
    const runs = (await readRuns(project.path).catch(() => [])).slice(0, RECENT_RUNS)
    for (const run of runs) items.push(activityFor(project, run))
  }
  items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return items
}

/**
 * The stable identity of an activity item: its kind + project + run. The kind is part of the key
 * so a run's `started` and `finished` are two separate announcements (one when it kicks off, one
 * when it lands), each firing exactly once.
 */
export function activityKey(item: Activity): string {
  return `${item.kind}:${item.projectId}:${item.runId}`
}

/**
 * The activity items in `current` not already in `seen` (by {@link activityKey}) — the transitions
 * that just happened. Drives both the browser hook and the daemon's Discord watcher: each keeps the
 * keys it has already announced, so only genuinely new transitions notify. (The dashboard keeps a
 * client-side copy of this; it can't import runtime values from this package without dragging
 * Node-only modules into the browser bundle.)
 */
export function pickNewActivity(seen: ReadonlySet<string>, current: Activity[]): Activity[] {
  return current.filter(item => !seen.has(activityKey(item)))
}

/**
 * How one activity item reads on Discord: a started run, or a finished one tagged by its outcome.
 * Beside {@link Activity} for the same reason {@link interventionLine} sits beside `Intervention`
 * — it switches on the kind, so it belongs with the type that declares the kinds.
 */
export function activityLine(item: Activity): string {
  const what = item.title ?? 'a session'
  if (item.kind === 'started') return `▶️ started: ${what}`
  const mark = item.status === 'failed' ? '❌' : item.status === 'stopped' ? '⏹️' : '✅'
  return `${mark} finished: ${what}`
}

/** Post the given activity items to a Discord webhook as one message. `fetch` is injectable for tests. */
export async function postActivityDiscord(
  webhook: string,
  items: Activity[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (items.length === 0) return
  const content =
    items.length === 1
      ? `📣 Activity (${items[0]!.projectName}): ${activityLine(items[0]!)}`
      : `📣 ${items.length} session updates:\n${items.map(i => `• ${i.projectName}: ${activityLine(i)}`).join('\n')}`
  await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}
