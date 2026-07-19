import { PreviewCard } from '@base-ui-components/react/preview-card'
import type { FileDiff } from '@gemstack/framework'
import { onFileDiff } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { DiffStat, DiffView } from './DiffView.js'

// Hover a changed file in the tree, see what changed (#816). Clicking a file is already taken —
// it toggles the path in the run Context (#504) — so hover is the free gesture. Base UI's
// PreviewCard is the hover-card primitive: it holds open while the pointer travels into the card,
// so a long diff stays scrollable.
//
// The card is its own component because a closed PreviewCard does not mount its popup: mounting
// *is* opening, so the read is lazy by construction (nothing is fetched for the files you never
// point at) with no open-state bookkeeping. It resolves the selected run's worktree, so it shows
// the change the dot came from (#815).

export function FileDiffCard({
  projectId,
  runId,
  path,
}: {
  projectId: string
  runId?: string | null | undefined
  path: string
}) {
  // Polled, not read once: the card is open over a session that is still editing, so the diff
  // under the pointer keeps up rather than freezing at whatever it was when you hovered.
  const { value: diff, loaded } = usePolled<FileDiff | null>(
    () => onFileDiff(projectId, path, runId ?? undefined),
    null,
    5_000,
    [projectId, runId, path],
  )

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {diff && <DiffStat added={diff.added} removed={diff.removed} className="ml-auto" />}
      </header>
      {!loaded ? (
        <p className="p-2 text-xs text-muted-foreground">Reading the diff…</p>
      ) : diff ? (
        <DiffView diff={diff} className="py-1" />
      ) : (
        <p className="p-2 text-xs text-muted-foreground">No change to show.</p>
      )}
    </>
  )
}

export function FileDiffHover({
  projectId,
  runId,
  path,
  children,
}: {
  projectId: string
  runId?: string | null | undefined
  path: string
  children: React.ReactNode
}) {
  return (
    <PreviewCard.Root>
      {/* The tree's rows are `pointer-events-none` so only the label is clickable; the trigger has
          to take them back, or there is nothing to hover. */}
      <PreviewCard.Trigger delay={350} closeDelay={150} render={<div className="pointer-events-auto" />}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="left" align="start" sideOffset={8}>
          <PreviewCard.Popup className="z-50 flex max-h-[70vh] w-[42rem] max-w-[80vw] flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg">
            <FileDiffCard projectId={projectId} runId={runId} path={path} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
