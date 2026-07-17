import { readLiveMeta, type RunMeta } from '../store/index.js'
import type { ProjectSummary } from './projects.js'

// The interventions queue (#632, part of the Queue #624): the cross-project "needs you" list.
// Rom's design (#624): proposals and finished work are both just PRs, so the bulk of what
// needs a human is the set of open PRs across the registered projects — merge to confirm,
// close to reject. This rolls those up, the same way overview.ts rolls up running runs. The
// second source (#636) is a run paused at an await gate — a live run whose latest state is an
// unresolved choice, waiting for the user's answer. #627 notifications ride this whole set.

/**
 * One item awaiting the human. Two kinds: an open `pr` to review/merge or close, and an
 * `awaiting` run paused on a choice gate. The card, the browser hook, and the Discord watcher
 * all iterate the flat list, branching on `kind` for the fields that differ.
 */
export interface Intervention {
  projectId: string
  projectName: string
  /** `pr` = an open PR to review/merge or close; `awaiting` = a run paused on a choice gate (#636). */
  kind: 'pr' | 'awaiting'
  title: string
  /** Where to act: the PR on GitHub (`pr`), or the dashboard (`awaiting`, when the URL is known). */
  url: string
  /** The PR number (`pr` only). */
  number?: number
  /** The parked gate's id (`awaiting` only) — its stable identity, so it notifies exactly once. */
  awaitId?: string
  /** When the PR was opened (`pr`) or the run last updated (`awaiting`), ISO, for ordering. */
  createdAt?: string
}

/** An open PR as the lister reports it. */
export interface OpenPr {
  number: number
  title: string
  url: string
  /** Draft PRs are not ready for review, so they are left off the queue. */
  isDraft: boolean
  createdAt?: string
}

/** Lists a checkout's open PRs; resolves `[]` when there is no remote / gh is unavailable. */
export type PrLister = (cwd: string) => Promise<OpenPr[]>

/** A {@link PrLister} via the `gh` CLI; resolves `[]` when gh is missing/unauthed or there is no remote. */
export function nodeGhPrLister(): PrLister {
  return cwd =>
    new Promise(resolve => {
      void import('node:child_process').then(({ execFile }) => {
        const args = ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,isDraft,createdAt']
        execFile('gh', args, { cwd, timeout: 8_000 }, (err, stdout) => {
          if (err) return resolve([])
          try {
            resolve(JSON.parse(String(stdout)) as OpenPr[])
          } catch {
            resolve([])
          }
        })
      })
    })
}

/** Injectable seam so {@link buildInterventions} is unit-testable off disk. */
export interface InterventionsDeps {
  prs?: PrLister
  /** The live-run meta reader (default {@link readLiveMeta}); drives the `awaiting` source (#636). */
  liveMeta?: (cwd: string) => Promise<RunMeta | undefined>
  /**
   * The dashboard's own URL, so an `awaiting` item can link back to it. Only the daemon knows
   * it (the card path resolves the project client-side and needs no URL), so it is optional; an
   * awaiting item's `url` is empty when it is unset.
   */
  dashboardUrl?: string
}

/**
 * Build the cross-project interventions queue: every registered project's open, non-draft PRs,
 * plus any run currently paused on a choice gate (#636), newest first. Forgiving — a project
 * with no remote (or an unreadable one) simply contributes nothing. Draft PRs are excluded:
 * they are not yet asking for review.
 */
export async function buildInterventions(
  projects: ProjectSummary[],
  deps: InterventionsDeps = {},
): Promise<Intervention[]> {
  const prs = deps.prs ?? nodeGhPrLister()
  const liveMeta = deps.liveMeta ?? readLiveMeta
  const items: Intervention[] = []
  for (const project of projects) {
    const open = await prs(project.path).catch(() => [])
    for (const pr of open) {
      if (pr.isDraft) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'pr',
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
      })
    }
    // A run paused mid-flight to ask the user is a "needs you" too (#636): a live run that is
    // still `running` and has an unresolved choice gate. One per project (a run parks on one
    // gate at a time), keyed on the gate id so it notifies once.
    const meta = await liveMeta(project.path).catch(() => undefined)
    if (meta?.status === 'running' && meta.pendingChoice) {
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'awaiting',
        title: meta.pendingChoice.title,
        url: deps.dashboardUrl ?? '',
        awaitId: meta.pendingChoice.id,
        ...(meta.updatedAt ? { createdAt: meta.updatedAt } : {}),
      })
    }
  }
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry. Collapse by identity, keeping the first (newest-sorted).
  const seen = new Set<string>()
  return items.filter(item => (seen.has(interventionKey(item)) ? false : (seen.add(interventionKey(item)), true)))
}

/**
 * The stable identity of an intervention. A PR is its url (survives title edits and re-sorts);
 * an awaiting run is its project + gate id, since its url is the shared dashboard URL and would
 * otherwise collide across projects.
 */
export function interventionKey(item: Intervention): string {
  return item.kind === 'awaiting' ? `awaiting:${item.projectId}:${item.awaitId ?? ''}` : item.url
}

/**
 * The interventions in `current` not already in `seen` (by {@link interventionKey}) — the ones
 * that just landed on the queue. Drives the daemon's Discord watcher (#627): the watcher keeps
 * the keys it has already announced, so only genuinely new items notify. (The dashboard keeps a
 * client-side copy of this for browser notifications; it can't import runtime values from this
 * package without dragging Node-only modules into the browser bundle.)
 */
export function pickNewInterventions(seen: ReadonlySet<string>, current: Intervention[]): Intervention[] {
  return current.filter(item => !seen.has(interventionKey(item)))
}
