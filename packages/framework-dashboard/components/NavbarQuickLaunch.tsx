import { useRef, useState } from 'react'
import { sendStart } from '../server/control.telefunc.js'
import { usePreferences } from '../lib/preferences.js'
import { collectRunOptions } from '../lib/run-options.js'
import { Composer, type ComposerHandle } from './Composer.js'

// The global quick-launch (#723): the same shared Composer as the launcher, compact, in the top
// navbar. Type a prompt, ⌘/Ctrl+Enter, and it starts a run in the SELECTED project and jumps to its
// live output (the #705 follow-on-start flow via onRunStarted). Options come from the shared prefs
// the launcher's controls write, so a quick-launch matches what a full Start would send. Targets the
// selected project only; with none selected it shows a disabled hint (the full launcher is where you
// pick a project). `@`/`#` mentions add to the shared run Context, same as the launcher.
export function NavbarQuickLaunch({
  projectId,
  projectName,
  files,
  context,
  addContext,
  onRunStarted,
  className,
}: {
  projectId: string | null
  projectName?: string | null | undefined
  files: string[]
  context: Set<string>
  addContext: (path: string) => void
  onRunStarted: (intent: string, runId?: string) => void
  className?: string
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preferences = usePreferences()

  // No project selected: nothing to launch into. Show a muted hint rather than a live editor.
  if (!projectId) {
    return (
      <div className={className}>
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Select a project to quick-launch a run
        </div>
      </div>
    )
  }

  const submit = async (text: string, kind: 'build' | 'prompt') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendStart(projectId, text, kind, collectRunOptions(preferences, [...context]))
      if (result.ok) {
        composerRef.current?.clear()
        onRunStarted(text, result.runId) // select the run we just started (#761)
      } else {
        setError(result.busy ? 'A run is already active for this project.' : result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the run.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <Composer
        ref={composerRef}
        compact
        files={files}
        addContext={addContext}
        onSubmit={submit}
        onPromptChange={() => error && setError(null)}
        busy={busy}
        submitLabel="Start"
        submitBusyLabel="…"
        placeholder={`Quick-launch a run${projectName ? ` in ${projectName}` : ''}…  ( / commands · @ projects · # files )`}
      />
      {error && <p className="mt-1 truncate text-xs text-red-500" title={error}>{error}</p>}
    </div>
  )
}
