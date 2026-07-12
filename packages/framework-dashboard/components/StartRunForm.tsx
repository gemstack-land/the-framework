import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  renderResearchPrompt,
  renderReadabilityPrompt,
  renderMaintainabilityPrompt,
  renderMaintainabilityMinimalPrompt,
} from '@gemstack/framework/client'
import { sendStart } from '../server/control.telefunc.js'
import { autopilotOn, setAutopilot } from '../lib/autopilot.js'
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

  const [autopilot, setAutopilotState] = useState(autopilotOn)
  const [technical, setTechnical] = useState(false)
  const [vanilla, setVanilla] = useState(false)
  const [eco, setEco] = useState(false)
  const [ecoPlanning, setEcoPlanning] = useState(false)
  const [ecoResearch, setEcoResearch] = useState(false)
  const [ecoMaintenance, setEcoMaintenance] = useState(false)

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

  const toggleAutopilot = (on: boolean) => {
    setAutopilotState(on)
    setAutopilot(on) // keep the choice-gate countdown in lockstep (#433)
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
          <input type="checkbox" checked={autopilot} onChange={e => toggleAutopilot(e.target.checked)} disabled={busy} /> Autopilot
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="Expose technical detail (e.g. tech-stack choices)">
          <input type="checkbox" checked={technical} onChange={e => setTechnical(e.target.checked)} disabled={busy} /> Technical control
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="Remove all system prompts: the same as raw Claude Code">
          <input type="checkbox" checked={vanilla} onChange={e => setVanilla(e.target.checked)} disabled={busy} /> Vanilla
        </label>
        <label className={cn('flex items-center gap-1.5', ecoDisabled ? 'opacity-40' : 'cursor-pointer')} title="Trim the built-in system prompt to save tokens">
          <input type="checkbox" checked={eco && !ecoDisabled} onChange={e => setEco(e.target.checked)} disabled={busy || ecoDisabled} /> Eco
        </label>
      </div>

      {eco && !ecoDisabled && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 pl-4 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the planning section, letting the agent plan on its own">
            <input type="checkbox" checked={ecoPlanning} onChange={e => setEcoPlanning(e.target.checked)} disabled={busy} /> Auto planning
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the alternatives/variability section">
            <input type="checkbox" checked={ecoResearch} onChange={e => setEcoResearch(e.target.checked)} disabled={busy} /> Auto research
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Drop the maintenance section">
            <input type="checkbox" checked={ecoMaintenance} onChange={e => setEcoMaintenance(e.target.checked)} disabled={busy} /> Auto maintenance
          </label>
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
