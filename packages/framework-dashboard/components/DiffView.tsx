import type { FileContent, FileDiff } from '@gemstack/framework'
import { cn } from '../lib/utils.js'

// What a file looks like in a card: its diff from git's unified output (#816), shared by the
// tree's hover card and the run view's Changes section (#817) so a change reads the same wherever
// you meet it, and an unchanged file's contents (#828).
//
// Deliberately plain: colored +/- lines, no syntax highlighting, no editing. The dashboard is
// not an editor (the risk raised on #475) — this is here to answer "what did the session do"
// and "what is in this file", nothing more.

/** Said once, so a cut diff and a cut file explain themselves the same way. */
function Cut() {
  return <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>
}

/** Said once: a file we cannot render as text. */
function Binary() {
  return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
}

/** Added/removed counts as the `+12 −3` pair the tree and the run view both show. */
export function DiffStat({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn('shrink-0 font-mono text-[10px] tabular-nums', className)}>
      {added > 0 && <span className="text-success">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  )
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
  if (line.startsWith('@@')) return 'text-primary'
  // Both themes: the 300s wash out on a light background, the 700s on a dark one.
  if (line.startsWith('+')) return 'bg-success/10 text-success'
  if (line.startsWith('-')) return 'bg-danger/10 text-danger'
  return 'text-muted-foreground'
}

export function DiffView({ diff, className }: { diff: FileDiff; className?: string }) {
  if (diff.binary) return <Binary />
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.45]', className)}>
      {diff.patch.split('\n').map((line, i) => (
        <div key={i} className={cn('whitespace-pre px-2', lineClass(line))}>
          {line || ' '}
        </div>
      ))}
      {diff.truncated && <Cut />}
    </div>
  )
}

// An unchanged file has no +/- to color, so it gets line numbers instead: they are what makes a
// plain body scannable, and they are how you say "line 40" to the session in the composer.
export function ContentView({ content, className }: { content: FileContent; className?: string }) {
  if (content.binary) return <Binary />
  if (!content.text) return <p className="p-2 text-xs text-muted-foreground">Empty file.</p>
  const lines = content.text.split('\n')
  const width = `${String(lines.length).length + 1}ch`
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.45]', className)}>
      {lines.map((line, i) => (
        <div key={i} className="flex whitespace-pre px-2 text-foreground">
          <span className="shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/60" style={{ width }}>
            {i + 1}
          </span>
          <span>{line || ' '}</span>
        </div>
      ))}
      {content.truncated && <Cut />}
    </div>
  )
}
