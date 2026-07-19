import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import {
  renderResearchPrompt,
  renderReadabilityPrompt,
  renderMaintainabilityPrompt,
  renderSecurityAuditPrompt,
  renderUxPrompt,
  renderSuggestNewTicketsPrompt,
} from '@gemstack/framework/client'
import { usePreferences, updatePreferences, autopilotEnabled, themePreference } from '../lib/preferences.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'
import { PresetMenu } from './PresetMenu.js'
import { AgentModelMenu, type AgentOption } from './AgentModelMenu.js'
import { OptionsMenu, type OptionRow } from './OptionsMenu.js'
import { ClaudeLogo, CodexLogo } from './agent-logos.js'
import { Button } from './ui/button.js'

// The presets (#353/#433): each PREFILLS the editor with a rendered prompt and runs it verbatim
// (`kind: 'prompt'`). Emptying the box falls back to a normal `build` run.
const PRESETS: { id: string; label: string; render: () => string }[] = [
  { id: 'research', label: 'Research', render: renderResearchPrompt },
  { id: 'readability', label: 'Readability', render: renderReadabilityPrompt },
  { id: 'maintainability', label: 'Maintainability', render: renderMaintainabilityPrompt },
  { id: 'security-audit', label: 'Security audit', render: renderSecurityAuditPrompt },
  { id: 'ux', label: 'UX', render: renderUxPrompt },
  { id: 'suggest-new-tickets', label: 'Suggest new tickets', render: renderSuggestNewTicketsPrompt },
]

// The agent + model tree (#650/#656/#658): each agent lists ONLY its own models, since `--model`
// passes straight through to that agent's CLI. Picking a model in an agent's submenu sets both, so
// an incompatible pair can't be chosen. Empty value = the agent's own default (no `--model` flag).
// Kept as a client const so the dashboard bundle never imports the node-only driver layer.
const AGENTS: AgentOption[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: <ClaudeLogo className="h-4 w-4" />,
    models: [
      { value: '', label: 'Default model' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ],
  },
  {
    value: 'codex',
    label: 'Codex',
    icon: <CodexLogo className="h-4 w-4" />,
    models: [
      { value: '', label: 'Default model' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'o3', label: 'o3' },
    ],
  },
]

export interface ComposerHandle {
  clear: () => void
  focus: () => void
}

// The shared run composer (#721): the Tiptap editor (`/` `<` `@` `#` triggers, presets, mentions)
// plus the control row — agent/model select, presets menu, Global-options gear, and the submit
// button. Factored out of the launcher (StartRunForm) so the run-view chat (RunChat) gets the exact
// same surface, wired to the same data (projects, files, presets, prefs). The caller owns what
// happens on submit: the launcher starts a run (with collected options), the chat sends a message.
export const Composer = forwardRef<ComposerHandle, {
  /** Registered projects for the `@` picker. */
  projects: ProjectSummary[]
  /** The current project's files for the `#` picker (#504). */
  files: string[]
  /** Add a path to the run Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Run the composed text. `kind` is `prompt` once a preset was loaded, else `build`. */
  onSubmit: (text: string, kind: 'build' | 'prompt') => void | Promise<void>
  /** Mirror the live prompt + kind out, so the launcher can drive its disclosure/context UI. */
  onPromptChange?: ((prompt: string, kind: 'build' | 'prompt') => void) | undefined
  /** A preset was loaded (so the launcher can flag it in its note). */
  onPreset?: ((label: string) => void) | undefined
  busy: boolean
  submitLabel: string
  submitBusyLabel: string
  placeholder?: string | undefined
  /** Show the ⌘↵ hint on the submit button (the launcher's Start). */
  showShortcutHint?: boolean | undefined
  /** Compact single-row form for the navbar quick-launch (#723): editor + submit, no control row
   *  or preset panel. The `/` `<` `@` `#` triggers still work; agent/model + options come from the
   *  shared prefs the launcher sets. */
  compact?: boolean | undefined
}>(function Composer(
  { projects, files, addContext, onSubmit, onPromptChange, onPreset, busy, submitLabel, submitBusyLabel, placeholder, showShortcutHint = false, compact = false },
  ref,
) {
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'build' | 'prompt'>('build')
  const [addingPreset, setAddingPreset] = useState(false)
  const editorRef = useRef<PromptEditorHandle>(null)

  const preferences = usePreferences()
  const autopilot = autopilotEnabled(preferences)
  const technical = preferences.technical ?? false
  const vanilla = preferences.vanilla ?? false
  const transparent = preferences.transparent ?? false // #625: the master off-switch (raw Claude Code)
  const eco = preferences.eco ?? false
  const ecoPlanning = preferences.ecoPlanning ?? false
  const ecoResearch = preferences.ecoResearch ?? false
  const ecoMaintenance = preferences.ecoMaintenance ?? false
  const onBeforeMergeableQuality = preferences.onBeforeMergeableQuality ?? false
  const browser = preferences.browser ?? false
  const model = preferences.model ?? '' // #628: empty = the driver's default model
  const agent = preferences.agent ?? 'claude' // #650: which coding agent drives the run
  const customPresets = preferences.customPresets ?? [] // #626: the user's own saved prompts
  const theme = themePreference(preferences) // #725: system (default) / light / dark

  // Vanilla removes the system prompt (nothing left for Eco to trim); Transparent turns off the
  // whole framework, so it overrides the rest too.
  const ecoDisabled = vanilla || transparent

  useImperativeHandle(ref, () => ({
    clear: () => {
      editorRef.current?.clear()
      setPrompt('')
      setKind('build')
    },
    focus: () => editorRef.current?.focus(),
  }))

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    void onSubmit(text, kind)
  }

  // A preset button (or the `/` menu) loads the rendered template into the editor, which chip-ifies
  // its tags; the run then goes verbatim as a `prompt` kind.
  const loadPreset = (label: string) => {
    setKind('prompt')
    onPreset?.(label)
  }

  const onPromptEdit = (value: string) => {
    setPrompt(value)
    // An emptied box is a fresh start: back to a normal build run.
    const nextKind = !value.trim() && kind !== 'build' ? 'build' : kind
    if (nextKind !== kind) setKind(nextKind)
    onPromptChange?.(value, nextKind)
  }

  // The Global options as one table (#314). Autopilot's default-on lives in `autopilotEnabled`; Eco
  // is disabled + dimmed under Vanilla; the Eco sub-drops show only while Eco is on.
  const mainOptions: OptionRow[] = [
    { key: 'transparent', label: 'Transparent', description: 'Raw Claude Code — turns the whole framework off.', title: 'Fully transparent (#625): run the agent exactly like plain Claude Code, with no framework system prompt, controls, dashboard, guard, or TODO loop. Overrides the options below.', checked: transparent },
    { key: 'autopilot', label: 'Autopilot', description: 'Auto-accepts the recommended choice after a countdown.', title: 'Auto-accept the recommended choice after a countdown; also relaxes the maintenance stance', checked: autopilot && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'technical', label: 'Technical control', description: 'Surfaces technical detail like tech-stack choices.', title: 'Expose technical detail (e.g. tech-stack choices)', checked: technical && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'vanilla', label: 'Disable system prompt', description: 'Drops the added system prompt; keeps the run controls.', title: "Remove the built-in system prompt but keep the framework's run controls. For a fully raw run, use Transparent. Expand 'Actual prompt' to read what it removes.", checked: vanilla && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'eco', label: 'Eco', description: 'Trims the system prompt to save tokens.', title: 'Trim the built-in system prompt to save tokens', checked: eco && !ecoDisabled, disabled: ecoDisabled, disabledReason: 'nothing to trim while the system prompt is off' },
    { key: 'onBeforeMergeableQuality', label: 'Post-merge cleanup', description: 'Runs quality passes once it is ready to merge.', title: "When the run signals it's ready for merge, run maintainability, readability, and security-audit passes", checked: onBeforeMergeableQuality && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'browser', label: 'Browser', description: 'Gives the agent a real browser to inspect pages.', title: 'Give the agent a real browser via chrome-devtools-mcp: navigate pages, read console + network, inspect the DOM, and screenshot', checked: browser && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
  ]
  const ecoOptions: OptionRow[] = [
    { key: 'ecoPlanning', label: 'Auto planning', description: 'Drops the planning section; the agent plans itself.', title: 'Drop the planning section, letting the agent plan on its own', checked: ecoPlanning },
    { key: 'ecoResearch', label: 'Auto research', description: 'Drops the alternatives/variability section.', title: 'Drop the alternatives/variability section', checked: ecoResearch },
    { key: 'ecoMaintenance', label: 'Auto maintenance', description: 'Drops the maintenance section.', title: 'Drop the maintenance section', checked: ecoMaintenance },
  ]

  const editorEl = (
    <PromptEditor
      ref={editorRef}
      compact={compact}
      onChange={onPromptEdit}
      onSubmit={submit}
      onPreset={loadPreset}
      onMentionProject={addContext}
      onMentionFile={addContext}
      projects={projects}
      files={files}
      presets={PRESETS}
      disabled={busy}
      {...(placeholder ? { placeholder } : {})}
    />
  )

  // Compact (#723): one row of editor + submit for the navbar. The `/` `<` `@` `#` triggers still
  // work in the editor; the agent/model + options controls are dropped (they come from prefs).
  if (compact) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{editorEl}</div>
        <Button
          type="submit"
          size="sm"
          onClick={submit}
          disabled={busy || !prompt.trim()}
          title={!prompt.trim() ? 'Type a prompt first' : `${submitLabel}  (⌘↵ / Ctrl+Enter)`}
        >
          {busy ? submitBusyLabel : submitLabel}
        </Button>
      </div>
    )
  }

  return (
    <>
      {editorEl}

      {/* Run controls, directly under the editor (#649/#650/#654/#668): agent+model at the start,
          then presets and the options gear, then submit at the end. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AgentModelMenu
          agents={AGENTS}
          agent={agent}
          model={model}
          onChange={(a, m) => updatePreferences({ agent: a, model: m })}
          busy={busy}
        />
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
        <OptionsMenu
          options={mainOptions}
          ecoOptions={ecoOptions}
          showEco={eco && !ecoDisabled}
          busy={busy}
          theme={theme}
          onThemeChange={t => updatePreferences({ theme: t })}
        />
        <Button
          type="submit"
          onClick={submit}
          className="ml-auto"
          disabled={busy || !prompt.trim()}
          title={!prompt.trim() ? 'Type a prompt first' : `${submitLabel}  (⌘↵ / Ctrl+Enter)`}
        >
          {busy ? (
            submitBusyLabel
          ) : (
            <>
              {submitLabel}
              {showShortcutHint && (
                // The editor submits on ⌘/Ctrl+Enter (#695/U13): surface the otherwise-hidden shortcut.
                <kbd className="ml-1.5 hidden rounded border border-primary-foreground/30 px-1 text-[10px] font-medium text-primary-foreground/70 sm:inline">
                  ⌘↵
                </kbd>
              )}
            </>
          )}
        </Button>
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
    </>
  )
})
