import { useRef, useState } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { sendStart } from '../server/control.telefunc.js'
import { onProjects } from '../server/projects.telefunc.js'
import { usePreferences, updatePreferences, autopilotEnabled } from '../lib/preferences.js'
import { collectRunOptions } from '../lib/run-options.js'
import { useLoaded } from '../lib/use-async.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { ContextFiles } from './ContextFiles.js'
import { DisclosureToggle } from './DisclosureToggle.js'
import { SystemPromptDisclosure } from './SystemPromptDisclosure.js'

// Start a run in the selected project (#405): the one write that goes through the daemon's own
// `startRun` (with its one-run-per-project busy guard), posted over Telefunc. The editor + control
// row are the shared Composer (#721); this form owns the submit (sendStart with the collected
// Global options), the system-prompt preview, and the Context selector. Shown when no run is active;
// a `busy` result means one already is.
export function StartRunForm({
  projectId,
  onRunStarted,
  files,
  context,
  addContext,
  toggleContext,
}: {
  projectId: string
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** The run Context set, shared with the right-rail file tree (#492) — owned by the shell. */
  context: Set<string>
  /** Add a path to the Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Toggle a path in the Context (from a repo checkbox). */
  toggleContext: (path: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // The Global options persist daemon-side (#410), shared with the choice-gate countdown.
  const preferences = usePreferences()
  const autopilot = autopilotEnabled(preferences)
  const vanilla = preferences.vanilla ?? false
  const transparent = preferences.transparent ?? false // #625: the master off-switch (raw Claude Code)
  const eco = preferences.eco ?? false
  const ecoPlanning = preferences.ecoPlanning ?? false
  const ecoResearch = preferences.ecoResearch ?? false
  const ecoMaintenance = preferences.ecoMaintenance ?? false

  // Context selector (#439/#314): the agent can reach every registered repo, so ticking a subset
  // narrows its focus — the picked paths become one `Context:` line in the system prompt.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const [showContext, setShowContext] = useState(false)

  // The Context set mixes whole repos (registered project paths) and individual files (relative
  // paths). Split out the files so they can be shown + removed, and count each kind separately.
  const projectPaths = new Set(projects.map(p => p.path))
  const contextFiles = [...context].filter(path => !projectPaths.has(path))
  // The current project is already the run's workspace, so it isn't offered as a focus target
  // (#665) — only the other registered repos are, and only those count toward the header.
  const otherProjects = projects.filter(p => p.id !== projectId)
  const selectedRepos = otherProjects.filter(p => context.has(p.path)).length
  const contextSummary = [
    selectedRepos > 0 ? `${selectedRepos} project${selectedRepos > 1 ? 's' : ''}` : null,
    contextFiles.length > 0 ? `${contextFiles.length} file${contextFiles.length > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // The eco drops for the system-prompt preview (#520): what the run trims is what you read. The run
  // itself gets them via collectRunOptions (which recomputes them from the same prefs).
  const ecoDrops = {
    ...(ecoPlanning ? { autoPlanning: true } : {}),
    ...(ecoResearch ? { autoResearch: true } : {}),
    ...(ecoMaintenance ? { autoMaintenance: true } : {}),
  }

  const submit = async (text: string, submitKind: 'build' | 'prompt') => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNote('Starting…')
    try {
      const result = await sendStart(projectId, text, submitKind, collectRunOptions(preferences, [...context]))
      if (result.ok) {
        // Show the run in the Runs rail immediately (#405): the spawned process writes its run.json
        // a beat later, so seed an optimistic row with the typed prompt until the real meta takes over.
        onRunStarted?.(text, result.runId) // select the run we just started (#761)
        composerRef.current?.clear()
        setPrompt('')
        setNote(null)
      } else {
        setNote(null)
        setError(result.busy ? 'A session is already active for this project.' : result.error)
      }
    } catch (err) {
      setNote(null)
      setError(err instanceof Error ? err.message : 'Failed to start the session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={e => e.preventDefault()} className="border-b border-border p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a session</div>
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        onSubmit={submit}
        onPromptChange={value => {
          setPrompt(value)
          if (!value.trim() && note) setNote(null)
        }}
        onPreset={label => {
          setError(null)
          setNote(`${label} preset loaded — review or edit, then Start`)
        }}
        busy={busy}
        submitLabel="Start session"
        submitBusyLabel="Starting…"
        showShortcutHint
      />

      <SystemPromptDisclosure
        prompt={prompt}
        disabled={vanilla}
        onDisabledChange={value => updatePreferences({ vanilla: value })}
        transparent={transparent}
        autopilot={autopilot}
        eco={eco && !vanilla ? ecoDrops : undefined}
        context={[...context]}
        busy={busy}
      />

      {(otherProjects.length > 0 || contextFiles.length > 0) && (
        <div className="mt-3 text-xs text-muted-foreground">
          <DisclosureToggle open={showContext} onToggle={() => setShowContext(s => !s)}>
            Context{contextSummary && <span className="text-primary"> · {contextSummary}</span>}
          </DisclosureToggle>
          {showContext && (
            <div className="mt-2 grid grid-cols-1 gap-4 rounded border border-border p-3 sm:grid-cols-2">
              {/* Projects: repo checkboxes. The agent can still reach every repo; ticking some just
                  narrows its focus (kept in the heading's tooltip). */}
              <div>
                <p className="mb-1.5 text-muted-foreground/80" title="The agent can still reach every repo; ticking some just narrows its focus.">
                  Projects
                </p>
                {otherProjects.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {otherProjects.map(p => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-1.5" title={p.path}>
                        <input type="checkbox" checked={context.has(p.path)} onChange={() => toggleContext(p.path)} disabled={busy} />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground/60">No other repos to add.</p>
                )}
              </div>
              {/* Files picked via a `#` mention or the file tree (#661): removable with an X. */}
              <div>
                <p className="mb-1 text-muted-foreground/80">Files</p>
                {contextFiles.length > 0 ? (
                  <ContextFiles files={contextFiles} onRemove={toggleContext} busy={busy} />
                ) : (
                  <p className="text-muted-foreground/60">None yet — add with # or the Files tab.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {note && !error && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </form>
  )
}
