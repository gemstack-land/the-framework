import { useRef, useState, type FormEvent } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import {
  renderResearchPrompt,
  renderReadabilityPrompt,
  renderMaintainabilityPrompt,
  renderSecurityAuditPrompt,
  renderUxPrompt,
} from '@gemstack/framework/client'
import { sendStart } from '../server/control.telefunc.js'
import { onProjects } from '../server/projects.telefunc.js'
import { usePreferences, updatePreferences, autopilotEnabled } from '../lib/preferences.js'
import { useLoaded } from '../lib/use-async.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { PresetMenu } from './PresetMenu.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'
import { AgentModelMenu } from './AgentModelMenu.js'
import { SystemPromptDisclosure } from './SystemPromptDisclosure.js'
import { OptionsMenu, type OptionRow } from './OptionsMenu.js'
import { Button } from './ui/button.js'

// The presets (#353/#433): each PREFILLS the textarea with a rendered prompt and runs it
// verbatim (`kind: 'prompt'`), the same as the old page.ts. Emptying the box falls back to
// a normal `build` run.
const PRESETS: { id: string; label: string; render: () => string }[] = [
  { id: 'research', label: 'Research', render: renderResearchPrompt },
  { id: 'readability', label: 'Readability', render: renderReadabilityPrompt },
  { id: 'maintainability', label: 'Maintainability', render: renderMaintainabilityPrompt },
  { id: 'security-audit', label: 'Security audit', render: renderSecurityAuditPrompt },
  { id: 'ux', label: 'UX', render: renderUxPrompt },
]

// The model picker below the textarea (#628): what the run passes as `--model`. Empty = the
// driver's own default (no flag). The aliases are Claude Code's, since it is the default driver;
// the value passes straight through to the wrapped agent, so a full model id typed into the
// registry works too.
const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Default model' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

// The coding agent that drives the run (#650): maps to `--agent`. Mirrors AGENTS in the
// framework's agent.ts — kept as a client const so the dashboard bundle never imports the
// node-only driver layer. `claude` is the default (empty flag).
const AGENTS: { value: string; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
]

// Start a run in the selected project (#405): the one write that goes through the daemon's
// own `startRun` (with its one-run-per-project busy guard), posted over Telefunc. The
// Global options (#314/#433) ride along: Autopilot, Technical control, Vanilla, and Eco
// (with its section drops). Shown when no run is active; a `busy` result means one already is.
export function StartRunForm({
  projectId,
  onRunStarted,
  files,
  context,
  addContext,
  toggleContext,
}: {
  projectId: string
  onRunStarted?: ((intent: string) => void) | undefined
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
  const [kind, setKind] = useState<'build' | 'prompt'>('build')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const editorRef = useRef<PromptEditorHandle>(null)

  // The Global options persist daemon-side (#410), shared with the choice-gate countdown.
  const preferences = usePreferences()
  const autopilot = autopilotEnabled(preferences)
  const technical = preferences.technical ?? false
  const vanilla = preferences.vanilla ?? false
  const eco = preferences.eco ?? false
  const ecoPlanning = preferences.ecoPlanning ?? false
  const ecoResearch = preferences.ecoResearch ?? false
  const ecoMaintenance = preferences.ecoMaintenance ?? false
  const onBeforeMergeableQuality = preferences.onBeforeMergeableQuality ?? false
  const browser = preferences.browser ?? false
  const model = preferences.model ?? '' // #628: empty = the driver's default model
  const agent = preferences.agent ?? 'claude' // #650: which coding agent drives the run
  const customPresets = preferences.customPresets ?? [] // #626: the user's own saved prompts
  const [addingPreset, setAddingPreset] = useState(false) // #649: the full-width "New preset" panel

  // Context selector (#439/#314): the agent can reach every registered repo, so ticking a
  // subset narrows its focus — the picked paths become one `Context:` line in the system
  // prompt. Loaded from the same registry the Projects sidebar shows.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const [showContext, setShowContext] = useState(false)

  // Vanilla removes the system prompt entirely, so Eco (which only trims it) has nothing
  // left to act on.
  const ecoDisabled = vanilla

  // The eco drops, hoisted: the run gets them via collectOptions, and the #520
  // preview renders with them, so what you read is what gets sent.
  const ecoDrops = {
    ...(ecoPlanning ? { autoPlanning: true } : {}),
    ...(ecoResearch ? { autoResearch: true } : {}),
    ...(ecoMaintenance ? { autoMaintenance: true } : {}),
  }

  const collectOptions = () => {
    return {
      ...(autopilot ? { autopilot: true } : {}),
      ...(technical ? { technical: true } : {}),
      ...(vanilla ? { vanilla: true } : {}),
      ...(eco && !vanilla && Object.keys(ecoDrops).length ? { eco: ecoDrops } : {}),
      ...(onBeforeMergeableQuality ? { onBeforeMergeable: true } : {}),
      ...(browser ? { browser: true } : {}),
      ...(model ? { model } : {}),
      ...(agent && agent !== 'claude' ? { agent } : {}),
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
        // Show the run in the Runs rail immediately (#405): the spawned process
        // writes its run.json a beat later, so seed an optimistic row with the
        // typed prompt until the real running meta takes over.
        onRunStarted?.(text)
        editorRef.current?.clear()
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

  // A preset button (or the `/` menu) loads the rendered template into the editor, which
  // chip-ifies its tags; the run then goes verbatim as a `prompt` kind.
  const loadPreset = (label: string) => {
    setKind('prompt')
    setError(null)
    setNote(`${label} preset loaded — review or edit, then Start`)
  }

  const onPromptChange = (value: string) => {
    setPrompt(value)
    // An emptied box is a fresh start: back to a normal build run.
    if (!value.trim() && kind !== 'build') {
      setKind('build')
      setNote(null)
    }
  }

  // The Global options as one table (#314). Autopilot's default-on lives in `autopilotEnabled`;
  // Eco is disabled + dimmed under Vanilla (nothing left to trim); the Eco sub-drops show only
  // while Eco is on.
  const mainOptions: OptionRow[] = [
    { key: 'autopilot', label: 'Autopilot', title: 'Auto-accept the recommended choice after a countdown; also relaxes the maintenance stance', checked: autopilot },
    { key: 'technical', label: 'Technical control', title: 'Expose technical detail (e.g. tech-stack choices)', checked: technical },
    { key: 'vanilla', label: 'Disable system prompt', title: "Remove all system prompts: the same as raw Claude Code. Expand 'See actual prompt sent' to read what it removes.", checked: vanilla },
    { key: 'eco', label: 'Eco', title: 'Trim the built-in system prompt to save tokens', checked: eco && !ecoDisabled, disabled: ecoDisabled },
    { key: 'onBeforeMergeableQuality', label: 'Post-merge cleanup', title: "When the run signals it's ready for merge, run maintainability, readability, and security-audit passes", checked: onBeforeMergeableQuality },
    { key: 'browser', label: 'Browser', title: 'Give the agent a real browser via chrome-devtools-mcp: navigate pages, read console + network, inspect the DOM, and screenshot', checked: browser },
  ]
  const ecoOptions: OptionRow[] = [
    { key: 'ecoPlanning', label: 'Auto planning', title: 'Drop the planning section, letting the agent plan on its own', checked: ecoPlanning },
    { key: 'ecoResearch', label: 'Auto research', title: 'Drop the alternatives/variability section', checked: ecoResearch },
    { key: 'ecoMaintenance', label: 'Auto maintenance', title: 'Drop the maintenance section', checked: ecoMaintenance },
  ]

  return (
    <form onSubmit={submit} className="border-b border-border p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a run</div>
      <PromptEditor
        ref={editorRef}
        onChange={onPromptChange}
        onSubmit={() => void submit()}
        onPreset={loadPreset}
        onMentionProject={addContext}
        onMentionFile={addContext}
        projects={projects}
        files={files}
        presets={PRESETS}
        disabled={busy}
      />

      {/* Run controls, directly under the textarea (#649/#650/#654): presets and options on the
          left, agent+model at the end — all compact matching dropdowns. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PresetMenu
          builtIns={PRESETS}
          customPresets={customPresets}
          busy={busy}
          onLoadBuiltIn={p => {
            editorRef.current?.loadTemplate(p.render())
            loadPreset(p.label)
          }}
          onUseCustom={preset => {
            editorRef.current?.loadTemplate(preset.prompt)
            loadPreset(preset.label)
          }}
          onDeleteCustom={id => updatePreferences({ customPresets: customPresets.filter(p => p.id !== id) })}
          onNewPreset={() => setAddingPreset(true)}
        />
        {/* Global options (#314) as a checkbox dropdown (#654). */}
        <OptionsMenu options={mainOptions} ecoOptions={ecoOptions} showEco={eco && !ecoDisabled} busy={busy} />
        {/* Agent (#650) + Model (#628) in one dropdown, each a submenu — pushed to the end. */}
        <div className="ml-auto">
          <AgentModelMenu
            agent={agent}
            agentOptions={AGENTS}
            onAgentChange={a => updatePreferences({ agent: a })}
            model={model}
            modelOptions={MODELS}
            onModelChange={m => updatePreferences({ model: m })}
            busy={busy}
          />
        </div>
      </div>

      {addingPreset && (
        <PresetCreatePanel
          currentPrompt={prompt}
          busy={busy}
          onCancel={() => setAddingPreset(false)}
          onSave={preset => {
            updatePreferences({ customPresets: [...customPresets, preset] })
            setAddingPreset(false)
          }}
        />
      )}

      <SystemPromptDisclosure
        prompt={prompt}
        disabled={vanilla}
        onDisabledChange={value => updatePreferences({ vanilla: value })}
        autopilot={autopilot}
        eco={eco && !vanilla ? ecoDrops : undefined}
        context={[...context]}
        busy={busy}
      />

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
