import { useState } from 'react'
import type { RunHandoff } from '@gemstack/framework'
import { GitBranch, GitPullRequest, Upload } from 'lucide-react'
import { onRunHandoff } from '../server/reads.telefunc.js'
import { sendOpenPullRequest, sendPushBranch } from '../server/control.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { DiffStat } from './DiffView.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'

// The end-of-session handoff (#799): what this session produced, and the next step offered rather
// than described. Before this, a finished session showed no branch, no commits and no diff, so
// finding out what it actually did meant leaving the dashboard for the command line.
//
// Shown only for a finished session, and only when there is something true to say. The read is
// branch-addressed, so it survives the checkout: a clean run's worktree is removed when it ends.

const MAX_COMMITS = 6
const MAX_FILES = 10

export function RunHandoffPanel({ projectId, runId }: { projectId: string; runId: string }) {
  // Polled rather than read once: a push or a PR opened from here (or from a terminal) changes
  // what the panel should offer, and `reload` makes the panel's own actions land immediately.
  const { value: handoff, reload, loaded } = usePolled<RunHandoff | null>(
    () => onRunHandoff(projectId, runId),
    null,
    15_000,
    [projectId, runId],
  )
  const { busy, error, run } = useAction()
  // Which button is in flight, so it can say "Pushing…" rather than silently greying (#948).
  const [pending, setPending] = useState<'push' | 'pr' | null>(null)

  // Nothing read yet, or nothing to report (no git repo, unknown session): say nothing rather
  // than flash a wrong empty state.
  if (!loaded || !handoff) return null

  const act = (which: 'push' | 'pr', fn: () => Promise<unknown>, fallback: string): void => {
    setPending(which)
    void run(fn, fallback).then(result => {
      setPending(null)
      if (result !== undefined) reload()
    })
  }

  return (
    <section className="border-b border-border px-4 py-3 text-xs" aria-label="Session handoff">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground" title={handoff.branch}>
            {handoff.branch}
          </span>
          <CopyButton text={handoff.branch} label="Copy branch name" />
        </span>
        <Summary handoff={handoff} />
        <div className="min-w-0 flex-1" />
        {error && <span className="text-danger">{error}</span>}
        <Actions handoff={handoff} busy={busy} pending={pending} act={act} projectId={projectId} runId={runId} />
      </div>
      {!handoff.empty && handoff.exists && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Commits handoff={handoff} />
          <Files handoff={handoff} />
        </div>
      )}
    </section>
  )
}

/** The one-line verdict: what the session left behind, or that it left nothing. */
function Summary({ handoff }: { handoff: RunHandoff }) {
  // A branch that is gone and a branch that was never pushed are different facts, and the panel
  // is only useful if it tells them apart.
  if (!handoff.exists) {
    return <span className="text-muted-foreground">Branch is gone, so there is nothing left to hand off.</span>
  }
  if (handoff.empty) {
    return <span className="text-muted-foreground">This session changed nothing, so there is nothing to hand off.</span>
  }
  const commits = `${handoff.commits.length} commit${handoff.commits.length === 1 ? '' : 's'}`
  const files = `${handoff.files.length} file${handoff.files.length === 1 ? '' : 's'}`
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
      <span>{commits}</span>
      <span>·</span>
      <span>{files}</span>
      <DiffStat added={handoff.insertions} removed={handoff.deletions} className="text-xs" />
      {/* Whether the work is on the remote yet is the first handoff question — say it. */}
      {handoff.pushed && !handoff.pr && <span className="text-muted-foreground">· pushed</span>}
      {handoff.merged && <span className="text-muted-foreground">· merged</span>}
    </span>
  )
}

/**
 * The next step, as a button.
 *
 * Push and Open PR are clicks, never automatic: both publish the agent's work to a shared remote
 * under the user's name. Once a PR exists it is shown instead, because the interventions queue
 * (#632) has picked it up by then and the loop is closed.
 */
function Actions({
  handoff,
  busy,
  pending,
  act,
  projectId,
  runId,
}: {
  handoff: RunHandoff
  busy: boolean
  pending: 'push' | 'pr' | null
  act: (which: 'push' | 'pr', fn: () => Promise<unknown>, fallback: string) => void
  projectId: string
  runId: string
}) {
  if (!handoff.exists || handoff.empty) return null
  if (handoff.pr) {
    return (
      <a
        href={handoff.pr.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-primary hover:underline"
        title={handoff.pr.title}
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span>PR #{handoff.pr.number}</span>
        <span className="rounded-full border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
          {handoff.pr.state.toLowerCase()}
        </span>
      </a>
    )
  }
  // No remote means neither action can work, and a disabled button with no reason is worse than
  // a sentence saying why.
  if (!handoff.hasRemote) return <span className="text-muted-foreground">No remote to push to.</span>
  return (
    <div className="flex items-center gap-2">
      {!handoff.pushed && (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => act('push', () => sendPushBranch(projectId, runId), 'Could not push the branch.')}
        >
          <Upload className="h-3.5 w-3.5" />
          {pending === 'push' ? 'Pushing…' : 'Push branch'}
        </Button>
      )}
      <Button
        size="xs"
        disabled={busy}
        onClick={() => act('pr', () => sendOpenPullRequest(projectId, runId), 'Could not open the pull request.')}
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        {pending === 'pr' ? 'Opening PR…' : 'Open PR'}
      </Button>
    </div>
  )
}

/** What the session committed. Capped, with the remainder counted rather than dropped silently. */
function Commits({ handoff }: { handoff: RunHandoff }) {
  const shown = handoff.commits.slice(0, MAX_COMMITS)
  const rest = handoff.commits.length - shown.length
  return (
    <div>
      <h3 className="mb-1.5 text-muted-foreground">Commits</h3>
      <ul className="space-y-1">
        {shown.map(commit => (
          <li key={commit.sha} className="flex gap-2">
            <code className="shrink-0 text-muted-foreground">{commit.short}</code>
            <span className="truncate" title={commit.subject}>
              {commit.subject}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-1 text-muted-foreground">and {rest} more</p>}
    </div>
  )
}

/** What the session changed. Same capping rule as the commits. */
function Files({ handoff }: { handoff: RunHandoff }) {
  const shown = handoff.files.slice(0, MAX_FILES)
  const rest = handoff.files.length - shown.length
  return (
    <div>
      <h3 className="mb-1.5 text-muted-foreground">Changed files</h3>
      <ul className="space-y-1">
        {shown.map(file => (
          <li key={file.path} className="flex items-center gap-2">
            <span className="truncate" title={file.path}>
              {file.path}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {file.binary ? 'binary' : <DiffStat added={file.insertions} removed={file.deletions} className="text-xs" />}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-1 text-muted-foreground">and {rest} more</p>}
    </div>
  )
}
