import { listRuns, readLiveMetas, type LiveRun, type RunMeta } from '../store/index.js'
import type { ProjectSummary } from './projects.js'
import { isSessionBranch, readRunHandoff, runBranchFor, type RunHandoff } from './run-handoff.js'
import { ghPrList, type OpenPr, type PrLister } from './gh.js'
import { interventionKey } from './keys.js'
import { postDiscordWebhook } from './discord-webhook.js'

// Pure identity + diff, in the leaf `keys.ts` so the dashboard shares them rather than copying.
export { interventionKey, pickNewInterventions } from './keys.js'

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
  /**
   * `pr` = an open PR to review/merge or close; `awaiting` = a run paused on a choice gate (#636);
   * `unpushed` = a finished run whose branch has commits that were never pushed (#860).
   */
  kind: 'pr' | 'awaiting' | 'unpushed'
  title: string
  /** Where to act: the PR on GitHub (`pr`), or the dashboard (the other two, when the URL is known). */
  url: string
  /** The PR number (`pr` only). */
  number?: number
  /** The parked gate's id (`awaiting` only) — its stable identity, so it notifies exactly once. */
  awaitId?: string
  /** Which run this is about (`awaiting` #738 / `unpushed`): a project has several runs. */
  runId?: string
  /** The branch the work is sitting on (`unpushed` only). */
  branch?: string
  /** How many commits are waiting (`unpushed` only). */
  commits?: number
  /** When the PR was opened (`pr`) or the run last updated (the other two), ISO, for ordering. */
  createdAt?: string
}

/** Injectable seam so {@link buildInterventions} is unit-testable off disk. */
export interface InterventionsDeps {
  prs?: PrLister
  /** The live-run reader (default {@link readLiveMetas}); drives the `awaiting` source (#636). */
  liveRuns?: (cwd: string) => Promise<LiveRun[]>
  /** The finished-run reader (default {@link listRuns}); drives the `unpushed` source (#860). */
  runs?: (cwd: string) => Promise<RunMeta[]>
  /** Reads a branch's state (default {@link readRunHandoff}); drives the `unpushed` source (#860). */
  handoff?: (cwd: string, branch: string) => Promise<RunHandoff | undefined>
  /**
   * How many of a project's most recent finished runs to inspect for unpushed work. Each one costs
   * a handful of git reads, and this runs on a poll, so old history is not re-walked every minute:
   * work that has sat unpushed for dozens of runs is not news, and the run list stays the record.
   */
  handoffLimit?: number
  /**
   * The dashboard's own URL, so an `awaiting` item can link back to it. Only the daemon knows
   * it (the card path resolves the project client-side and needs no URL), so it is optional; an
   * awaiting item's `url` is empty when it is unset.
   */
  dashboardUrl?: string
}

/** How many recent finished runs are inspected per project by default. */
export const HANDOFF_LIMIT = 5

/**
 * Build the cross-project interventions queue: every registered project's open PRs, plus any run
 * currently paused on a choice gate (#636), newest first. Forgiving — a project with no remote
 * (or an unreadable one) simply contributes nothing. Hand-opened draft PRs are excluded: they are
 * not yet asking for review. A session's own draft is not (#1102), because that is how
 * auto-handoff hands work back.
 */
export async function buildInterventions(
  projects: ProjectSummary[],
  deps: InterventionsDeps = {},
): Promise<Intervention[]> {
  const prs = deps.prs ?? ghPrList
  const liveRuns = deps.liveRuns ?? readLiveMetas
  const items: Intervention[] = []
  for (const project of projects) {
    const open = await prs(project.path).catch(() => [])
    for (const pr of open) {
      // A draft opened by hand is not asking for review, so it stays off the queue. A draft the
      // framework opened for a session is the opposite (#1102): auto-handoff opens it as a draft
      // precisely so it does not ping reviewers, and if the queue then dropped it too, nothing
      // would tell anyone the work exists — which is the whole of #860 again.
      if (pr.isDraft && !isSessionBranch(pr.headRefName)) continue
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
    // still `running` and has an unresolved choice gate. A run parks on one gate at a time, but
    // a project now has several concurrent runs (#736), so each parked run contributes its own
    // item — keyed on the gate id, plus the run id so two runs are told apart.
    for (const meta of await liveRuns(project.path).catch(() => [])) {
      if (meta.status !== 'running' || !meta.pendingChoice) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'awaiting',
        title: meta.pendingChoice.title,
        url: deps.dashboardUrl ?? '',
        awaitId: meta.pendingChoice.id,
        runId: meta.id,
        ...(meta.updatedAt ? { createdAt: meta.updatedAt } : {}),
      })
    }
    // A finished run whose work never left the machine is a "needs you" too (#860). Until now the
    // queue only knew about a PR that is *already on GitHub* and a run parked on a gate, so a run
    // that committed real code and stopped produced neither, and nothing told anyone: the overview
    // drops it (it filters on `running`) and the handoff panel is behind clicking into that run.
    //
    // Surfacing only: this says there is a decision waiting, it does not take it. Since #1102 a
    // session usually pushes itself, so what reaches here is the remainder — auto-handoff turned
    // off for the project, or turned off for that session, or tried and failed.
    for (const item of await unpushedFor(project, deps).catch(() => [])) items.push(item)
  }
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  // The same repo can be registered under two projects (e.g. a monorepo root + a subdir), so a
  // PR would otherwise appear once per entry. Collapse by identity, keeping the first (newest-sorted).
  const seen = new Set<string>()
  return items.filter(item => (seen.has(interventionKey(item)) ? false : (seen.add(interventionKey(item)), true)))
}

/**
 * The finished runs of a project whose branch still holds unpushed, unmerged commits (#860).
 *
 * Only the most recent {@link InterventionsDeps.handoffLimit} finished runs are inspected: each
 * costs several git reads and this runs on a poll.
 */
async function unpushedFor(project: ProjectSummary, deps: InterventionsDeps): Promise<Intervention[]> {
  const runs = deps.runs ?? listRuns
  const handoff =
    deps.handoff ??
    // The default skips the `gh` PR lookup `readRunHandoff` would otherwise do per branch: an open
    // PR means the branch was pushed, so `pushed` already excludes it, and the `pr` kind above is
    // what surfaces it. Paying an 8s-timeout network call per run on every poll to learn that
    // would be the most expensive part of this whole queue.
    ((cwd: string, branch: string) => readRunHandoff(cwd, branch, { pr: async () => undefined }))

  const finished = (await runs(project.path))
    .filter(run => run.status !== 'running')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .slice(0, deps.handoffLimit ?? HANDOFF_LIMIT)

  const items: Intervention[] = []
  for (const run of finished) {
    const branch = runBranchFor(run)
    const state = await handoff(project.path, branch).catch(() => undefined)
    // Every condition is a reason this is *not* waiting on anyone: the branch is gone, the session
    // wrote nothing, it already landed, it is already on the remote, or there is nowhere to push.
    if (!state || !state.exists || state.empty || state.merged || state.pushed || !state.hasRemote) continue
    items.push({
      projectId: project.id,
      projectName: project.name,
      kind: 'unpushed',
      title: run.intent?.trim() || branch,
      url: deps.dashboardUrl ?? '',
      runId: run.id,
      branch,
      commits: state.commits.length,
      ...(run.updatedAt ? { createdAt: run.updatedAt } : {}),
    })
  }
  return items
}

/**
 * How one intervention reads on Discord. Beside {@link Intervention} rather than inside the
 * watcher that posts it: it switches on every `kind`, so adding a kind is a change here, not in
 * a transport module that has no other opinion about what an intervention is.
 *
 * A PR reads `#123 Title — url`; a paused run (#636) has no number and only the dashboard url,
 * so it reads `Title — awaiting your answer` with the link appended when the daemon knows it.
 * Unpushed work (#860) names the branch, since that is the actionable part.
 */
export function interventionLine(item: Intervention): string {
  if (item.kind === 'awaiting') return `${item.title} — awaiting your answer${item.url ? ` — ${item.url}` : ''}`
  if (item.kind === 'unpushed') {
    const count = item.commits === 1 ? '1 commit' : `${item.commits ?? 0} commits`
    return `${item.title} — ${count} on ${item.branch ?? ''}, never pushed${item.url ? ` — ${item.url}` : ''}`
  }
  return `#${item.number} ${item.title} — ${item.url}`
}

/**
 * Post the given interventions to a Discord webhook as one message, resolving whether Discord
 * accepted it (#940). `fetch` is injectable for tests.
 */
export async function postInterventionsDiscord(
  webhook: string,
  items: Intervention[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (items.length === 0) return true
  const content =
    items.length === 1
      ? `🔔 Needs you (${items[0]!.projectName}): ${interventionLine(items[0]!)}`
      : `🔔 ${items.length} items need you:\n${items.map(i => `• ${interventionLine(i)}`).join('\n')}`
  return postDiscordWebhook(webhook, content, fetchImpl)
}
