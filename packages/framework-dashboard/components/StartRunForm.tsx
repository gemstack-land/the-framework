import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import {
  renderResearchPrompt,
  renderReadabilityPrompt,
  renderMaintainabilityPrompt,
  renderMaintainabilityMinimalPrompt,
} from '@gemstack/framework/client'
import { sendStart } from '../server/control.telefunc.js'
import { onProjects } from '../server/projects.telefunc.js'
import { usePreferences, updatePreferences, autopilotEnabled } from '../lib/preferences.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// The presets (#353/#433): each PREFILLS the textarea with a rendered prompt and runs it
// verbatim (`kind: 'prompt'`), the same as the old page.ts. Emptying the box falls back to
// a normal `build` run.
const PRESETS: { id: string; label: string; render: () => string }[] = [
  { id: 'research', label: 'Research', render: renderResearchPrompt },
  { id: 'readability', label: 'Readability', render: renderReadabilityPrompt },
  { id: 'maintainability', label: 'Maintainability', render: renderMaintainabilityPrompt },
  { id: 'maintainability-minimal', label: 'Maintainability (minimal)', render: renderMaintainabilityMinimalPrompt },
]

// Start a run in the selected project (#405): the one write that goes through the daemon's
// own `startRun` (with its one-run-per-project busy guard), posted over Telefunc. The
// Global options (#314/#433) ride along: Autopilot, Technical control, Vanilla, and Eco
// (with its section drops). Shown when no run is active; a `busy` result means one already is.
export function StartRunForm({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'build' | 'prompt'>('build')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // The Global options persist daemon-side (#410), shared with the choice-gate countdown.
  const preferences = usePreferences()
  const autopilot = autopilotEnabled(preferences)
  const technical = preferences.technical ?? false
  const vanilla = preferences.vanilla ?? false
  const eco = preferences.eco ?? false
  const ecoPlanning = preferences.ecoPlanning ?? false
  const ecoResearch = preferences.ecoResearch ?? false
  const ecoMaintenance = preferences.ecoMaintenance ?? false

  // Context selector (#439/#314): the agent can reach every registered repo, so ticking a
  // subset narrows its focus — the picked paths become one `Context:` line in the system
  // prompt. Loaded from the same registry the Projects sidebar shows.
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [context, setContext] = useState<Set<string>>(new Set())
  const [showContext, setShowContext] = useState(false)

  useEffect(() => {
    let live = true
    void onProjects().then(list => live && setProjects(list))
    return () => {
      live = false
    }
  }, [])

  const toggleContext = (path: string) =>
    setContext(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  // Vanilla removes the system prompt entirely, so Eco (which only trims it) has nothing
  // left to act on.
  const ecoDisabled = vanilla

  const collectOptions = () => {
    const ecoOpts = {
      ...(ecoPlanning ? { autoPlanning: true } : {}),
      ...(ecoResearch ? { autoResearch: true } : {}),
      ...(ecoMaintenance ? { autoMaintenance: true } : {}),
    }
    return {
      ...(autopilot ? { autopilot: true } : {}),
      ...(technical ? { technical: true } : {}),
      ...(vanilla ? { vanilla: true } : {}),
      ...(eco && !vanilla && Object.keys(ecoOpts).length ? { eco: ecoOpts } : {}),
      ...(context.size ? { context: [...context] } : {}),
    }
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setNote('Starting…')
    try {
      const result = await sendStart(projectId, text, kind, collectOptions())
      if (result.ok) {
        setPrompt('')
        setKind('build')
        setNote(null)
      } else {
        setNote(null)
        setError(result.busy ? 'A run is already active for this project.' : result.error)
      }
    } catch (err) {
      setNote(null)
      setError(err instanceof Error ? err.message : 'Failed to start the run.')
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
  }

  const loadPreset = (p: (typeof PRESETS)[number]) => {
    setPrompt(p.render())
    setKind('prompt')
    setError(null)
    setNote(`${p.label} preset loaded — review or edit, then Start`)
  }

  const onPromptChange = (value: string) => {
    setPrompt(value)
    // An emptied box is a fresh start: back to a normal build run.
    if (!value.trim() && kind !== 'build') {
      setKind('build')
      setNote(null)
    }
  }

  return (
    <form onSubmit={submit} className="border-b border-border p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a run</div>
      <textarea
        value={prompt}
        onChange={e => onPromptChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe what to build…"
        rows={2}
        disabled={busy}
        className="w-full resize-y rounded-md border border-border bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <Button key={p.id} type="button" variant="outline" size="sm" disabled={busy} onClick={() => loadPreset(p)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-1.5" title="Auto-accept the recommended choice after a countdown; also relaxes the maintenance stance">
          <input type="checkbox" checked={autopilot} onChange={e => updatePreferences({ autopilot: e.target.checked })} disabled={busy} /> Autopilot
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="Expose technical detail (e.g. tech-stack choices)">
          <input type="checkbox" checked={technical} onChange={e => updatePreferences({ technical: e.target.checked })} disabled={busy} /> Technical control
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="Remove all system prompts: the same as raw Claude Code">
          <input type="checkbox" checked={vanilla} onChange={e => updatePreferences({ vanilla: e.target.checked })} disabled={busy} /> Vanilla
        </label>
        <label className={cn('flex items-center gap-1.5', ecoDisabled ? 'opacity-40' : 'cursor-pointer')} title="Trim the built-in system prompt to save tokens">
          <input type="checkbox" checked={eco && !ecoDisabled} onChange={e => updatePreferences({ eco: e.target.checked })} disabled={busy || ecoDisabled} /> Eco
        </label>
      </div>

      {eco && !ecoDisabled && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 pl-4 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the planning section, letting the agent plan on its own">
            <input type="checkbox" checked={ecoPlanning} onChange={e => updatePreferences({ ecoPlanning: e.target.checked })} disabled={busy} /> Auto planning
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the alternatives/variability section">
            <input type="checkbox" checked={ecoResearch} onChange={e => updatePreferences({ ecoResearch: e.target.checked })} disabled={busy} /> Auto research
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the maintenance section">
            <input type="checkbox" checked={ecoMaintenance} onChange={e => updatePreferences({ ecoMaintenance: e.target.checked })} disabled={busy} /> Auto maintenance
          </label>
        </div>
      )}

      {projects.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowContext(s => !s)}
            className="flex items-center gap-1 font-medium hover:text-foreground"
          >
            <span className="inline-block w-3">{showContext ? '▾' : '▸'}</span>
            Context{context.size > 0 && <span className="text-primary"> · {context.size} selected</span>}
          </button>
          {showContext && (
            <div className="mt-1.5 pl-4">
              <p className="mb-1.5 text-muted-foreground/80">Focus the agent on these repos (it can still reach the rest):</p>
              <div className="flex flex-col gap-1">
                {projects.map(p => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-1.5" title={p.path}>
                    <input type="checkbox" checked={context.has(p.path)} onChange={() => toggleContext(p.path)} disabled={busy} />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? 'Starting…' : 'Start run'}
        </Button>
      </div>
    </form>
  )
}
