import { useEffect, useState } from 'react'
import { sendPreview, sendStopPreview, onPreviewStatus } from '../server/control.telefunc.js'
import { Button } from './ui/button.js'

// On-demand app Preview (#475): a per-project button that serves the project's built result
// (its dev script, else a static server) and surfaces the live URL + a Stop. Independent of
// any agent run — it closes the "let me see what it produced" loop with one click, useful for
// non-technical users too. State lives daemon-side, so a reload rehydrates via onPreviewStatus.
export function PreviewBar({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Rehydrate on load / project switch: reflect a preview the daemon is already serving.
  useEffect(() => {
    let live = true
    setUrl(null)
    setCommand(null)
    setError(null)
    void onPreviewStatus(projectId).then(status => {
      if (!live || !status.running) return
      setUrl(status.url ?? null)
      setCommand(status.command ?? null)
    })
    return () => {
      live = false
    }
  }, [projectId])

  const open = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await sendPreview(projectId)
      if (result.ok) {
        setUrl(result.url)
        setCommand(result.command)
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the preview.')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      await sendStopPreview(projectId)
      setUrl(null)
      setCommand(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
      {url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline" title={url}>
            {url}
          </a>
          {command && command !== 'static' && <span className="text-muted-foreground">npm run {command}</span>}
          <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={() => void stop()}>
            Stop preview
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Serve this project's built result</span>
          <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={() => void open()}>
            {busy ? 'Starting…' : '▶ Preview'}
          </Button>
        </>
      )}
      {error && <p className="w-full text-red-500">{error}</p>}
    </div>
  )
}
