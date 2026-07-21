import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { LAUNCHER_PRESETS } from '@gemstack/framework/client'
import {
  usePreferences,
  updatePreferences,
  autopilotEnabled,
  themePreference,
  usePreferenceSources,
  useProjectFileConfig,
} from '../lib/preferences.js'
import { useDetectedEditors } from '../lib/editors.js'
import { useLoaded } from '../lib/use-async.js'
import { onProjects } from '../server/projects.telefunc.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'
import { AgentModelMenu, type AgentOption } from './AgentModelMenu.js'
import { OptionsMenu, type OptionRow } from './OptionsMenu.js'
import { ResolvedOptions } from './ResolvedOptions.js'
import { ClaudeLogo, CodexLogo } from './agent-logos.js'
import { Button } from './ui/button.js'

// The presets (#353/#433): each PREFILLS the editor with a rendered prompt and runs it verbatim
// (`kind: 'prompt'`). Emptying the box falls back to a normal `build` run. The list, its order and
// each preset's label live with the presets themselves (#874), so a preset's run-kind name and the
// button that starts it cannot drift apart across the package boundary.
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
// same surface, wired to the same data (files, presets, prefs). The caller owns what happens on
// submit: the launcher starts a run (with collected options), the chat sends a message. The `@`
// picker's project list is Composer's own concern, so it loads it here (#743) rather than making
// every host pass the same list down.
export const Composer = forwardRef<ComposerHandle, {
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
  /** Off inside a session (#831): a session is bound to the agent it started with, so the select
   *  would only ever rewrite the *next* session's default. Chosen at the launcher instead. */
  showAgentModel?: boolean | undefined
  /** The session this composer sits in, if any (#874): a preset launched from a run page targets
   *  that session by default, instead of the whole codebase. Absent at the launcher, where no
   *  session exists yet. */
  sessionName?: string | undefined
}>(function Composer(
  { files, addContext, onSubmit, onPromptChange, onPreset, busy, submitLabel, submitBusyLabel, placeholder, showShortcutHint = false, compact = false, showAgentModel = true, sessionName },
  ref,
) {
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'build' | 'prompt'>('build')
  const [addingPreset, setAddingPreset] = useState(false)
  const editorRef = useRef<PromptEditorHandle>(null)
  // The registered projects for the `@` picker — the same list the launcher reads.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])

  const preferences = usePreferences()
  const sources = usePreferenceSources() // #842: which layer won each option
  const fileConfig = useProjectFileConfig() // #842: the repo's committed the-framework.yml
  const autopilot = autopilotEnabled(preferences)
  const technical = preferences.technical ?? false
  const vanilla = preferences.vanilla ?? false

  // Presets render against the session they are launched from (#874). The run pages pass their
  // session name so a preset targets that session by default; the launcher passes none, and the
  // default falls through to the whole codebase.
  const presets = useMemo(
    () =>
      LAUNCHER_PRESETS.map(p => ({
        id: p.name,
        label: p.label,
        ...(p.tooltip ? { tooltip: p.tooltip } : {}),
        render: () => p.render(undefined, { session_name: sessionName, settings: { technical_control: technical } }),
      })),
    [sessionName, technical],
  )
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
  const editor = preferences.editor // #727: preferred editor; undefined = $FRAMEWORK_EDITOR / code
  const detectedEditors = useDetectedEditors() // #727: editors installed on the daemon's machine
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
    // Says only what it does (#801): the maintenance stance it used to relax left the system prompt
    // with that section (#556), so the countdown is the whole feature.
    { key: 'autopilot', label: 'Autopilot', description: 'Auto-accepts the recommended choice after a countdown.', title: 'Auto-accept the recommended choice after a countdown, instead of waiting for you to pick', checked: autopilot && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'technical', label: 'Technical control', description: 'Surfaces technical detail like tech-stack choices.', title: 'Expose technical detail (e.g. tech-stack choices)', checked: technical && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'vanilla', label: 'Disable system prompt', description: 'Drops the added system prompt; keeps the session controls.', title: "Remove the built-in system prompt but keep the framework's session controls. For a fully raw session, use Transparent. Expand 'Enhanced System Prompt' to read what it removes.", checked: vanilla && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    { key: 'eco', label: 'Eco', description: 'Trims the system prompt to save tokens.', title: 'Trim the built-in system prompt to save tokens', checked: eco && !ecoDisabled, disabled: ecoDisabled, disabledReason: 'nothing to trim while the system prompt is off' },
    { key: 'onBeforeMergeableQuality', label: 'Post-merge cleanup', description: 'Runs quality passes once it is ready to merge.', title: "When the session signals it's ready for merge, run maintainability, readability, and security-audit passes", checked: onBeforeMergeableQuality && !transparent, disabled: transparent, disabledReason: 'off while Transparent is on' },
    // Claude-only (#801): the browser is wired through Claude Code's MCP config, so another agent's
    // driver takes no MCP servers and the box would be checkable but inert. The CLI has always
    // warned about this (`unguardedNotices`); now the dashboard says it too.
    { key: 'browser', label: 'Browser', description: 'Gives the agent a real browser to inspect pages.', title: 'Give the agent a real browser via chrome-devtools-mcp: navigate pages, read console + network, inspect the DOM, and screenshot', checked: browser && !transparent && agent === 'claude', disabled: transparent || agent !== 'claude', disabledReason: transparent ? 'off while Transparent is on' : 'only on Claude Code — the browser is wired through its MCP config' },
  ]
  const ecoOptions: OptionRow[] = [
    { key: 'ecoPlanning', label: 'Auto planning', description: 'Drops the planning section; the agent plans itself.', title: 'Drop the planning section, letting the agent plan on its own', checked: ecoPlanning },
    { key: 'ecoResearch', label: 'Auto research', description: 'Drops the alternatives/variability section.', title: 'Drop the alternatives/variability section', checked: ecoResearch },
    // Gated on Post-merge cleanup (#801): #556 moved the Maintenance section out of the system
    // prompt and into the on-before-mergeable prompt, so this trims nothing unless that pass runs.
    { key: 'ecoMaintenance', label: 'Auto maintenance', description: 'Drops the maintenance section from the post-merge prompt.', title: 'Drop the Maintenance section from the post-merge cleanup prompt', checked: ecoMaintenance && onBeforeMergeableQuality, disabled: !onBeforeMergeableQuality, disabledReason: 'only applies while Post-merge cleanup is on' },
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
      presets={presets}
      customPresets={customPresets}
      // The `/` menu offers "New preset…" only in the full composer, where the create panel renders;
      // the compact navbar launch has no panel, so it gets no callback (and no item).
      {...(compact ? {} : { onNewPreset: () => setAddingPreset(true) })}
      disabled={busy}
      {...(placeholder ? { placeholder } : {})}
    />
  )

  // The agent/model select and the options gear, shared by both forms (#755). They were compact's
  // one real omission: a run started from the navbar used the stored agent, model and options with
  // nothing on screen saying which. Every value is preferences-backed and global, so the same
  // controls in either place read and write the same state.
  const controls = (
    <>
      {showAgentModel && (
        <AgentModelMenu
          agents={AGENTS}
          agent={agent}
          model={model}
          onChange={(a, m) => updatePreferences({ agent: a, model: m })}
          busy={busy}
        />
      )}
      <OptionsMenu
        options={mainOptions}
        ecoOptions={ecoOptions}
        showEco={eco && !ecoDisabled}
        busy={busy}
        editor={editor}
        editors={detectedEditors}
        onEditorChange={e => updatePreferences({ editor: e ?? '' })}
        // Preset loading + "New preset…" moved to the `/` menu (#722); the gear keeps the manage
        // side, deleting a saved preset.
        customPresets={customPresets}
        onDeleteCustomPreset={id => updatePreferences({ customPresets: customPresets.filter(p => p.id !== id) })}
      />
    </>
  )

  // Compact (#723): a single row for the navbar — editor, then the same controls and submit. It
  // stays one row on purpose (#755): the header must not grow taller to gain them.
  if (compact) {
    return (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{editorEl}</div>
        {controls}
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {controls}
        <Button
          type="submit"
          size="sm"
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

      {/* What the session resolves to, without opening the gear (#842). Off in the compact row
          above, which is one line on purpose. */}
      <ResolvedOptions options={mainOptions} sources={sources} fileConfig={fileConfig} />

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
