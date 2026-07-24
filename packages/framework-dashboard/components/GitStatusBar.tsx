import { useEffect, useState, type ReactNode } from 'react'
import type { GitStatus, RunWorktree } from '@gemstack/the-framework'
import { ChevronRight, GitBranch } from 'lucide-react'
import { onGitStatus, onRunWorktree } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { formatBytes } from '@gemstack/the-framework/client'
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
//
// `summary` and `onToggle` make this row the one place a session's branch is spoken about (#1023):
// what the branch holds is said here, and clicking it expands the detail the caller renders below,
// instead of a second card underneath repeating the branch name.
export function GitStatusBar({
  projectId,
  runId,
  inline = false,
  label,
  summary,
  expanded = false,
  onToggle,
}: {
  projectId: string
  /** The session whose worktree to report; absent reports the project's checkout. */
  runId?: string | null | undefined
  inline?: boolean
  /** The session's name (#1030). Given, it leads as the bold identity and the branch drops to
   * muted git context beside it; absent (the project home), the branch stays the identity. */
  label?: string | undefined
  /** What the branch holds, in a phrase — rendered beside the branch's own status. */
  summary?: ReactNode
  expanded?: boolean
  /** Given, the branch reads as a disclosure for the detail the caller renders below. */
  onToggle?: (() => void) | undefined
}) {
  // Two reads, one shape: both carry branch/dirty/PR, because the server resolves them from
  // whichever checkout it was asked about, and the session read adds what only a worktree has.
  // Resting cadence is ten seconds, but a PR lookup still in flight (#1028) is an answer that
  // lands in under a second — worth asking again for rather than showing a gap for ten.
  const [everyMs, setEveryMs] = useState(10_000)
  const { value: status } = usePolled<GitStatus | RunWorktree | null>(
    () => (runId ? onRunWorktree(projectId, runId) : onGitStatus(projectId)),
    null,
    everyMs,
    [projectId, runId, everyMs],
    // Keep the previous status visible while the next session's loads, so the whole left cluster
    // (branch/dirty/PR/chevron) updates in place instead of vanishing to null and popping back.
    true,
  )
  useEffect(() => setEveryMs(status?.prPending ? 1_000 : 10_000), [status?.prPending])

  if (!status) return null

  const worktree = 'path' in status ? status : undefined
  const branch = status.branch
  const size = formatBytes(worktree?.sizeBytes, '')
  // A session's worktree is the agent's tree, so uncommitted work there is the agent's; on the
  // project's own checkout it is the user's. Same dot, honest wording.
  const dirtyLabel = worktree?.own ? 'Uncommitted changes in this session' : 'Uncommitted changes'

  const branchTitle = worktree ? `${branch ?? 'no branch'}\n${worktree.path}` : `branch ${branch}`
  // Beside a session label the `the-framework/` prefix is 14 characters of noise every session
  // branch shares (#1030); the short name reads, and the tooltip and copy keep the real thing.
  const branchText = label && branch ? branch.replace(/^the-framework\//, '') : (branch ?? 'no branch')

  // One flat row so exactly one element gives up width: the label (or, with no label, the branch).
  // Everything else is shrink-0 and drops out at a container width instead of squeezing to mush.
  const facts = (
    <>
      {/* The chevron only appears where there is something to open, so a bar without a
          disclosure doesn't advertise one. */}
      {onToggle && (
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
      )}
      {/* The session's name leads (#1030): it is what the rail calls this run and it does not
          change under you, unlike the branch, which the agent renames near the end (#736). It is
          the one element that shrinks, so it truncates last and the identity never disappears. */}
      {label && (
        <span className="min-w-0 truncate font-medium text-foreground" title={label}>
          {label}
        </span>
      )}
      {/* The branch: the identity when there is no session label (the project home), otherwise
          muted git context. Beside a label it yields width first — a high shrink factor means it
          truncates to make room for the name long before the name has to give any up (#1030). */}
      <span
        className={cn(
          'flex items-center gap-1.5 overflow-hidden',
          label
            ? 'hidden min-w-0 shrink-[999] text-muted-foreground @2xl:flex'
            : 'min-w-0 shrink-0 text-muted-foreground',
        )}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span
          className={cn('truncate', label ? 'max-w-[14rem]' : 'max-w-[16rem] font-medium text-foreground')}
          title={branchTitle}
        >
          {branchText}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/* Clean is neutral, not green. Green means "added / new / done" everywhere else, so a
            green dot for "nothing changed" sat one pane away from the file tree's green dot for
            "this folder HAS changes": the same colour for opposite facts. A clean tree is the
            unremarkable default and has nothing to announce. */}
        <span
          className={cn('h-2 w-2 rounded-full', status.dirty ? 'bg-warning' : 'bg-muted-foreground')}
          title={status.dirty ? dirtyLabel : 'Clean'}
        />
        <span className="text-muted-foreground">{status.dirty ? 'dirty' : 'clean'}</span>
      </span>
      {/* Only a worktree has a size worth showing, and only once nothing is writing to it (#798). */}
      {size && (
        <span className="hidden shrink-0 text-muted-foreground @4xl:inline" title="This session's worktree on disk">
          {size}
        </span>
      )}
      {/* The branch is the only part that gives up width (#1026): it truncates with an ellipsis
          and still reads, where a half-cut "0 files · me" does not. The facts furthest from the
          branch drop out first as the bar narrows, so it stays one line without colliding. */}
      <span className="hidden shrink-0 @5xl:inline">{summary}</span>
    </>
  )

  const content = (
    <>
      {/* A disclosure wraps only the facts: the PR link and the copy button are interactive in
          their own right and can't sit inside a button. */}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 overflow-hidden rounded text-left hover:text-foreground"
        >
          {facts}
        </button>
      ) : (
        facts
      )}
      {status.pr && (
        <a
          href={status.pr.url}
          target="_blank"
          rel="noreferrer"
          className={cn('flex shrink-0 items-center gap-1.5 text-primary hover:underline', !inline && 'ml-auto')}
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

  // `overflow-hidden`: on a pane too narrow for even the branch, it is cut off rather than
  // painted over the buttons beside it (#1026).
  if (inline) return <span className="flex min-w-0 items-center gap-2 overflow-hidden text-xs">{content}</span>

  return <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">{content}</div>
}
