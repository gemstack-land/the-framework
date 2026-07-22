import { useRef, useState } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { runOptionsFromPreferences } from '@gemstack/framework/client'
import { onProjects } from '../server/projects.telefunc.js'
import { onSystemPromptUser } from '../server/reads.telefunc.js'
import { usePreferences, updatePreferences, autopilotEnabled } from '../lib/preferences.js'
import { useStartRun } from '../lib/use-start-run.js'
import { useLoaded } from '../lib/use-async.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { ContextFiles } from './ContextFiles.js'
import { DisclosureToggle } from './DisclosureToggle.js'
import { SystemPromptDisclosure } from './SystemPromptDisclosure.js'
import { Checkbox } from './ui/checkbox.js'

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
  removeContext,
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
  /** Drop a path from the Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext: (path: string) => void
  /** Toggle a path in the Context (from a repo checkbox). */
  toggleContext: (path: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, reset, start } = useStartRun()
  const composerRef = useRef<ComposerHandle>(null)

  // The Global options persist daemon-side (#410), shared with the choice-gate countdown.
  const preferences = usePreferences()
  const autopilot = autopilotEnabled(preferences)
  const vanilla = preferences.vanilla ?? false
  const transparent = preferences.transparent ?? false // #625: the master off-switch (raw Claude Code)

  // Context selector (#439/#314): the agent can reach every registered repo, so ticking a subset
  // narrows its focus — the picked paths become one `Context:` line in the system prompt.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const [showContext, setShowContext] = useState(false)
  // The repo's own SYSTEM.md (#872): composition takes it as `user`, but reading it is
  // Node-bound, so without this read the "entire system prompt" preview under-reported.
  const userSystemPrompt = useLoaded<string | null>(() => onSystemPromptUser(projectId), null, [projectId])

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

  // The options this run will start with: the daemon's own mapping (#858), read once, so the
  // submit and the system-prompt preview below cannot disagree with the run they describe.
  const options = runOptionsFromPreferences(preferences, [...context])

  const submit = async (text: string, submitKind: 'build' | 'prompt') => {
    if (busy) return
    setNote('Starting…')
    const result = await start(projectId, text, submitKind, options)
    setNote(null)
    if (result) {
      // Show the run in the Runs rail immediately (#405): the spawned process writes its run.json
      // a beat later, so seed an optimistic row with the typed prompt until the real meta takes over.
      onRunStarted?.(text, result.runId) // select the run we just started (#761)
      composerRef.current?.clear()
      setPrompt('')
    }
  }

  return (
    <form onSubmit={e => e.preventDefault()} className="border-b border-border p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a session</div>
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        onSubmit={submit}
        onPromptChange={value => {
          setPrompt(value)
          if (!value.trim() && note) setNote(null)
          // Editing after a failed start: the red error described the old attempt, drop it (#948).
          if (error) reset()
        }}
        onPreset={(label, replaced) => {
          reset()
          setNote(
            replaced
              ? `${label} preset loaded over your draft — undo (⌘Z) brings the draft back`
              : `${label} preset loaded — review or edit, then Start`,
          )
        }}
        busy={busy}
        submitLabel="Start session"
        submitBusyLabel="Starting…"
      />

      {/* Feedback right where the action is (#948): the error used to render below the (possibly
          expanded, tall) Context disclosure, past the fold from the Start button that caused it. */}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {note && !error && <p role="status" className="mt-2 text-xs text-muted-foreground">{note}</p>}

      <SystemPromptDisclosure
        prompt={prompt}
        disabled={vanilla}
        onDisabledChange={value => updatePreferences({ vanilla: value })}
        transparent={transparent}
        onTransparentChange={value => updatePreferences({ transparent: value })}
        // Read off the options this form will really send, so the preview cannot claim a
        // smaller prompt than the run gets (#863 asks for the entire one). The browser
        // section is Claude-only, and that rule lives in the mapping rather than here.
        browser={options.browser ?? false}
        autopilot={autopilot}
        eco={options.eco}
        context={[...context]}
        user={userSystemPrompt}
        busy={busy}
      />

      {/* Always rendered (#948): hiding the whole section for a single-project setup also hid
          the only place that teaches the `#` / Files-tab focus flow. */}
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
                        <Checkbox checked={context.has(p.path)} onCheckedChange={() => toggleContext(p.path)} disabled={busy} />
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
    </form>
  )
}
