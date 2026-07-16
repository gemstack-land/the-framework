import type { GitStatus } from '@gemstack/framework'
import { GitBranch } from 'lucide-react'
import { onGitStatus } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'

// The project panel's git status (#491, part of #488): active branch, a clean/dirty dot, and
// the linked PR. Reads `onGitStatus`, polled so it tracks a run committing/branching. Hidden
// when the project is not a git repo (or on the relay, which has no local checkout).
// `inline` renders just the status (for the project action bar); otherwise a full-width row.
export function GitStatusBar({ projectId, inline = false }: { projectId: string; inline?: boolean }) {
  const { value: status } = usePolled<GitStatus | null>(() => onGitStatus(projectId), null, 10_000, [projectId])

  if (!status) return null

  const content = (
    <>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span className="max-w-[14rem] truncate font-medium text-foreground" title={`branch ${status.branch}`}>
          {status.branch}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn('h-2 w-2 rounded-full', status.dirty ? 'bg-amber-500' : 'bg-emerald-500')}
          title={status.dirty ? 'Uncommitted changes' : 'Clean'}
        />
        <span className="text-muted-foreground">{status.dirty ? 'dirty' : 'clean'}</span>
      </span>
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
