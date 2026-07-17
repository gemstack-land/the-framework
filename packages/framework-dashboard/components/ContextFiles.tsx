import { X } from 'lucide-react'

// The files picked into the run Context (#661), shown as removable chips. Files reach the Context
// two ways — a `#` mention in the prompt (#504) and the right-rail file tree — and both add the
// same relative path to the shared context set. Without this they were invisible once the prompt
// was cleared; each chip's X removes the file (which also unticks it in the file tree).

/** The last path segment, for a compact chip label. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

export function ContextFiles({
  files,
  onRemove,
  busy,
}: {
  /** The context entries that are files (not whole repos). */
  files: string[]
  /** Remove a file from the Context. */
  onRemove: (path: string) => void
  busy: boolean
}) {
  if (files.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {files.map(file => (
        <span
          key={file}
          className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
          title={file}
        >
          <span className="max-w-[14rem] truncate font-mono">{basename(file)}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(file)}
            aria-label={`Remove ${file} from context`}
            className="rounded p-0.5 text-muted-foreground hover:text-red-500 disabled:opacity-50"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
