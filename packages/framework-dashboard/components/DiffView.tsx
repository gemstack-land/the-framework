import type { FileDiff } from '@gemstack/framework'
import { cn } from '../lib/utils.js'

// One file's diff, rendered from git's unified output (#816). Shared by the tree's hover card
// and the run view's Changes section (#817), so a change reads the same wherever you meet it.
// Deliberately plain: colored +/- lines, no syntax highlighting, no editing. The dashboard is
// not an editor (the risk raised on #475) — this is here to answer "what did the session do".

/** Added/removed counts as the `+12 −3` pair the tree and the run view both show. */
export function DiffStat({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn('shrink-0 font-mono text-[10px] tabular-nums', className)}>
      {added > 0 && <span className="text-green-400">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="text-red-400">−{removed}</span>}
    </span>
  )
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
  if (line.startsWith('@@')) return 'text-primary'
  if (line.startsWith('+')) return 'bg-green-400/10 text-green-300'
  if (line.startsWith('-')) return 'bg-red-400/10 text-red-300'
  return 'text-muted-foreground'
}

export function DiffView({ diff, className }: { diff: FileDiff; className?: string }) {
  if (diff.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.45]', className)}>
      {diff.patch.split('\n').map((line, i) => (
        <div key={i} className={cn('whitespace-pre px-2', lineClass(line))}>
          {line || ' '}
        </div>
      ))}
      {diff.truncated && (
        <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>
      )}
    </div>
  )
}
