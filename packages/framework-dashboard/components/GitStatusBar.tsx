import type { GitStatus, RunWorktree } from '@gemstack/framework'
import { GitBranch } from 'lucide-react'
import { onGitStatus, onRunWorktree } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { formatBytes } from '@gemstack/framework/client'
import { cn } from '../lib/utils.js'

// The checkout in play (#491, part of #488): active branch, a clean/dirty dot, the linked PR.
// Polled, so it tracks a run committing or branching. Hidden when there is no git repo (or on
// the relay, which has no local checkout).
//
// One component for both pages (#809). With a `runId` it reads that session's own worktree, which
// also carries its size on disk and the path it lives at; without one it reads the project's
// checkout. A session used to have its own differently-styled chip, so the same facts wore two
// looks depending on the page, and either could drift with an edit to the other.
//
// `inline` renders just the status (for an action bar); otherwise a full-width row.
export function GitStatusBar({
  projectId,
  runId,
  inline = false,
}: {
  projectId: string
  /** The session whose worktree to report; absent reports the project's checkout. */
  runId?: string | null | undefined
  inline?: boolean
}) {
  // Two reads, one shape: both carry branch/dirty/PR, because the server resolves them from
  // whichever checkout it was asked about, and the session read adds what only a worktree has.
  const { value: status } = usePolled<GitStatus | RunWorktree | null>(
    () => (runId ? onRunWorktree(projectId, runId) : onGitStatus(projectId)),
    null,
    10_000,
    [projectId, runId],
  )

  if (!status) return null

  const worktree = 'path' in status ? status : undefined
  const branch = status.branch
  const size = formatBytes(worktree?.sizeBytes, '')
  // A session's worktree is the agent's tree, so uncommitted work there is the agent's; on the
  // project's own checkout it is the user's. Same dot, honest wording.
  const dirtyLabel = worktree?.own ? 'Uncommitted changes in this session' : 'Uncommitted changes'

  const content = (
    <>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span
          className="max-w-[14rem] truncate font-medium text-foreground"
          title={worktree ? `${branch ?? 'no branch'}\n${worktree.path}` : `branch ${branch}`}
        >
          {branch ?? 'no branch'}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn('h-2 w-2 rounded-full', status.dirty ? 'bg-amber-500' : 'bg-emerald-500')}
          title={status.dirty ? dirtyLabel : 'Clean'}
        />
        <span className="text-muted-foreground">{status.dirty ? 'dirty' : 'clean'}</span>
      </span>
      {/* Only a worktree has a size worth showing, and only once nothing is writing to it (#798). */}
      {size && (
        <span className="text-muted-foreground" title="This session's worktree on disk">
          {size}
        </span>
      )}
      {status.pr && (
        <a
          href={status.pr.url}
          target="_blank"
          rel="noreferrer"
          className={cn('flex items-center gap-1.5 text-primary hover:underline', !inline && 'ml-auto')}
          title={status.pr.title}
        >
          <span>PR #{status.pr.number}</span>
          <span className="rounded-full border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
            {status.pr.state.toLowerCase()}
          </span>
        </a>
      )}
    </>
  )

  if (inline) return <span className="flex items-center gap-2 text-xs">{content}</span>

  return <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">{content}</div>
}
