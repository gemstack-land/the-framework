import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { FileChange } from '@gemstack/framework'
import { onRunChanges } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { FilePreviewCard } from './FilePreview.js'
import { DiffStat } from './DiffView.js'
import { cn } from '../lib/utils.js'

// What the session changed, in the run view (#817). Watching a run you saw `· Edit` go by and
// never learned which file moved; finding out meant leaving the dashboard for `git diff`.
//
// Read from the run's worktree, not from the agent's tool calls: the driver surfaces a tool's
// name and not its arguments by design (#165), and deriving this from git is both the honest
// source (the outcome, not the intent) and the one that works for every agent. Each row expands
// to the same diff the tree's hover card shows (#816).
//
// This is the LIVE session's surface, and only that. A finished session is answered by the
// handoff panel (#799), which is branch-addressed and so survives the worktree removal that
// leaves this one with nothing to read.

const EMPTY: FileChange[] = []

const LABEL: Record<FileChange['status'], string> = {
  untracked: 'new',
  modified: 'modified',
  deleted: 'deleted',
}

const TONE: Record<FileChange['status'], string> = {
  untracked: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
}

function ChangeRow({ projectId, runId, change }: { projectId: string; runId: string; change: FileChange }) {
  const [open, setOpen] = useState(false)
  const dir = change.path.slice(0, change.path.lastIndexOf('/') + 1)
  const name = change.path.slice(change.path.lastIndexOf('/') + 1)

  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-muted-foreground">{dir}</span>
          <span className={cn(change.status === 'deleted' && 'line-through')}>{name}</span>
        </span>
        <span className={cn('shrink-0 text-[10px] uppercase tracking-wide', TONE[change.status])}>
          {LABEL[change.status]}
        </span>
        {!change.binary && <DiffStat added={change.added} removed={change.removed} />}
      </button>
      {/* Mounted only while open, so the run view costs one `git status` + one `numstat` until
          you actually ask for a file's diff. */}
      {open && (
        <div className="border-t border-border bg-muted/30">
          <FilePreviewCard projectId={projectId} runId={runId} path={change.path} />
        </div>
      )}
    </li>
  )
}

/** How many files the live session has touched, said in the action bar beside its branch (#1023). */
export function ChangesSummary({ count, added, removed }: { count: number; added: number; removed: number }) {
  if (count === 0) return null
  return (
    <span className="flex items-center gap-x-2 text-muted-foreground">
      <span>
        {count} {count === 1 ? 'file' : 'files'}
      </span>
      <DiffStat added={added} removed={removed} className="text-xs" />
    </span>
  )
}

/**
 * `runId` is required, and the caller must only render this for a session whose worktree is still
 * there. Once a worktree is gone `resolveRunPath` falls back to the project root, and the panel
 * would present the user's own uncommitted files as the session's work.
 *
 * The caller owns `open` and renders the count in the action bar, so the section carries no header
 * of its own: the branch row above says what changed, this says which files (#1023). It keeps
 * polling while collapsed — that count is the reason to open it.
 */
export function RunChanges({
  projectId,
  runId,
  open = true,
  onSummary,
}: {
  projectId: string
  runId: string
  open?: boolean
  /** Told the running totals, so the bar can offer them without a second read. */
  onSummary?: ((count: number, added: number, removed: number) => void) | undefined
}) {
  const { value: changes } = usePolled<FileChange[]>(
    () => onRunChanges(projectId, runId),
    EMPTY,
    8_000,
    [projectId, runId],
  )

  const added = changes.reduce((sum, c) => sum + c.added, 0)
  const removed = changes.reduce((sum, c) => sum + c.removed, 0)
  // Through a ref so a caller passing an inline function doesn't re-fire this every render.
  const report = useRef(onSummary)
  report.current = onSummary
  useEffect(() => report.current?.(changes.length, added, removed), [changes.length, added, removed])

  // A session that has changed nothing has nothing to say here, and an empty panel above the
  // output would only push the output down.
  if (changes.length === 0 || !open) return null

  return (
    <section className="border-b border-border" aria-label="Changed files">
      <ul className="max-h-80 overflow-auto">
        {changes.map(change => (
          <ChangeRow key={change.path} projectId={projectId} runId={runId} change={change} />
        ))}
      </ul>
    </section>
  )
}
