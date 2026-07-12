import { useState, type FormEvent } from 'react'
import { sendStart } from '../server/control.telefunc.js'
import { Button } from './ui/button.js'

// Start a run in the selected project (#405): the one write that goes through the
// daemon's own `startRun` (with its one-run-per-project busy guard), posted over
// Telefunc. Shown when no run is active; a `busy` result means one already is.
export function StartRunForm({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendStart(projectId, text)
      if (result.ok) setPrompt('')
      else setError(result.busy ? 'A run is already active for this project.' : result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the run.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-b border-border p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a run</div>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe what to build…"
        rows={2}
        disabled={busy}
        className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex justify-end">
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? 'Starting…' : 'Start run'}
        </Button>
      </div>
    </form>
  )
}
