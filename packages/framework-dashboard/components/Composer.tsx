import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { ProjectSummary } from '@gemstack/framework'
import { AGENTS, AGENT_LABELS, LAUNCHER_PRESETS, type AgentName } from '@gemstack/framework/client'
import {
  usePreferences,
  updatePreferences,
  autopilotEnabled,
  themePreference,
  usePreferenceSources,
  useProjectFileConfig,
  useProjectPresets,
  saveProjectPresetList,
  useActiveProjectId,
} from '../lib/preferences.js'
import { useLoaded } from '../lib/use-async.js'
import { onProjects } from '../server/projects.telefunc.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'
import { PresetsMenu } from './PresetsMenu.js'
import { AgentModelMenu, type AgentOption } from './AgentModelMenu.js'
import { OptionsMenu, type OptionRow, type RunTarget } from './OptionsMenu.js'
import { AddDeviceDialog } from './AddDeviceDialog.js'
import { useConnectionProfiles, connectTo, connectLocal, isLoopbackHost } from '../lib/profiles.js'
import { ResolvedOptions } from './ResolvedOptions.js'
import { ClaudeLogo, CodexLogo } from './agent-logos.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// The presets (#353/#433): each PREFILLS the editor with a rendered prompt and runs it verbatim
// (`kind: 'prompt'`). Emptying the box falls back to a normal `build` run. The list, its order and
// each preset's label live with the presets themselves (#874), so a preset's run-kind name and the
// button that starts it cannot drift apart across the package boundary.
// The agent + model tree (#650/#656/#658): each agent lists ONLY its own models, since `--model`
// passes straight through to that agent's CLI. Picking a model in an agent's submenu sets both, so
// an incompatible pair can't be chosen. Empty value = the agent's own default (no `--model` flag).
// The names and labels are the framework's own vocabulary (browser-safe via /client); only the
// icons and model lists are UI data, and the Record<AgentName, ...> shape means a new agent
// framework-side is a compile error here rather than a silently missing menu entry.
const AGENT_UI: Record<AgentName, { icon: AgentOption['icon']; models: AgentOption['models'] }> = {
  claude: {
    icon: <ClaudeLogo className="h-4 w-4" />,
    models: [
      { value: '', label: 'Default' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ],
  },
  codex: {
    icon: <CodexLogo className="h-4 w-4" />,
    models: [
      { value: '', label: 'Default' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'o3', label: 'o3' },
    ],
  },
}
const AGENT_OPTIONS: AgentOption[] = AGENTS.map(name => ({ value: name, label: AGENT_LABELS[name], ...AGENT_UI[name] }))

export interface ComposerHandle {
  clear: () => void
  focus: () => void
}

// The shared run composer (#721): the Tiptap editor (`/` `<` `@` `#` triggers, presets, mentions)
// plus the control row — agent/model select, presets menu, Global-options gear, and the submit
// button. Factored out of the launcher (StartRunForm) so the run-view chat (RunComposer) gets the exact
// same surface, wired to the same data (files, presets, prefs). The caller owns what happens on
// submit: the launcher starts a run (with collected options), the chat sends a message. The `@`
// picker's project list is Composer's own concern, so it loads it here (#743) rather than making
// every host pass the same list down.
export const Composer = forwardRef<ComposerHandle, {
  /** The current project's files for the `#` picker (#504). */
  files: string[]
  /** Add a path to the run Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Drop a path from the run Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext?: ((path: string) => void) | undefined
  /** Run the composed text. `kind` is `prompt` once a preset was loaded, else `build`.
   *  `newSession` (#959) says the loaded preset must open a session of its own, so the two
   *  in-session hosts send it as a new run instead of into the session they sit in. */
  onSubmit: (text: string, kind: 'build' | 'prompt', opts: { newSession: boolean }) => void | Promise<void>
  /** Mirror the live prompt + kind out, so the launcher can drive its disclosure/context UI. */
  onPromptChange?: ((prompt: string, kind: 'build' | 'prompt') => void) | undefined
  /** A preset was loaded (so the launcher can flag it in its note); `replaced` says a typed
   *  draft was overwritten (undo brings it back). */
  onPreset?: ((label: string, replaced: boolean) => void) | undefined
  busy: boolean
  submitLabel: string
  submitBusyLabel: string
  placeholder?: string | undefined
  /** Compact single-row form for the navbar quick-launch (#723): editor + submit, no control row
   *  or preset panel. The `/` `<` `@` `#` triggers still work; agent/model + options come from the
   *  shared prefs the launcher sets. */
  compact?: boolean | undefined
  /** Off inside a session (#831): a session is bound to the agent it started with, so the select
   *  would only ever rewrite the *next* session's default. Chosen at the launcher instead. */
  showAgentModel?: boolean | undefined
  /** Inside a running/finished session (#833): every run option is baked in at spawn, so the
   *  gear drops them (keeping the genuinely global editor pick) and the "In play" strip goes —
   *  both would otherwise read as controls over *this* session that only rewrite the next one. */
  inSession?: boolean | undefined
  /** The session this composer sits in, if any (#874): a preset launched from a run page targets
   *  that session by default, instead of the whole codebase. Absent at the launcher, where no
   *  session exists yet. */
  sessionName?: string | undefined
  /** A control the launcher hangs in the composer control row (#1046): the Context picker. Only the
   *  launcher passes one; in-session there is no launcher row. */
  contextControl?: ReactNode
  /** What the launcher puts at the start of the "In play" row (#1046): the Enhanced System Prompt
   *  disclosure, so it shares that row with the resolved-options strip. Its own expandable panel
   *  drops full-width below. Only the launcher passes one. */
  resolvedRowStart?: ReactNode
}>(function Composer(
  { files, addContext, removeContext, onSubmit, onPromptChange, onPreset, busy, submitLabel, submitBusyLabel, placeholder, compact = false, showAgentModel = true, inSession = false, sessionName, contextControl, resolvedRowStart },
  ref,
) {
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'build' | 'prompt'>('build')
  // Set by the loaded preset, not by the surface (#959). Cleared with the box, like `kind`.
  const [newSession, setNewSession] = useState(false)
  const [addingPreset, setAddingPreset] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false) // #1052: the "Add a device" modal
  const editorRef = useRef<PromptEditorHandle>(null)
  // The saved daemons this browser can hop to (#1052). Which one we are on now comes from the URL,
  // fixed for the page's life (a device switch reloads), so it is read once rather than as state.
  const profiles = useConnectionProfiles()
  const currentUrl = typeof window === 'undefined' ? null : window.location.origin
  const isLocalConnection = typeof window === 'undefined' ? true : isLoopbackHost(window.location.hostname)
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
        ...(p.newSession ? { newSession: true } : {}),
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
  const target = preferences.target ?? 'local' // #1050: where the run executes (this device / GitHub Actions)
  // The stored agent as a display name; an unknown stored value falls back to Claude Code.
  const agentLabel = AGENT_LABELS[AGENTS.includes(agent as AgentName) ? (agent as AgentName) : 'claude']
  const customPresets = preferences.customPresets ?? [] // #626: the user's own saved prompts
  const projectPresets = useProjectPresets() // #1025: presets committed in the open project's repo
  const activeProjectId = useActiveProjectId() // #1025: a project to commit a shared preset into
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

  // A synchronous latch alongside the async `busy` prop (#948): two fast ⌘↵ presses both read
  // `busy === false` (React state lags), fired two starts, and the second surfaced a spurious
  // "already active" error. The ref flips before any await.
  const submittingRef = useRef(false)
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || busy || submittingRef.current) return
    submittingRef.current = true
    void Promise.resolve(onSubmit(text, kind, { newSession })).finally(() => {
      submittingRef.current = false
    })
  }

  // A preset (from the `/` menu or the Presets button) loads the rendered template into the
  // editor, which chip-ifies its tags; the run then goes verbatim as a `prompt` kind.
  const loadPreset = (label: string, replaced: boolean, presetNewSession = false) => {
    setKind('prompt')
    setNewSession(presetNewSession)
    onPreset?.(label, replaced)
  }

  // The Presets button's load path (#948): through the imperative handle rather than the
  // suggestion plugin, then the same bookkeeping as the `/` menu.
  const loadPresetFromMenu = (text: string, label: string, presetNewSession?: boolean) => {
    const replaced = editorRef.current?.loadTemplate(text) ?? false
    loadPreset(label, replaced, presetNewSession)
  }

  const onPromptEdit = (value: string) => {
    setPrompt(value)
    // An emptied box is a fresh start: back to a normal build run.
    const nextKind = !value.trim() && kind !== 'build' ? 'build' : kind
    if (nextKind !== kind) setKind(nextKind)
    // Emptying the box drops the preset, and with it its new-session rule.
    if (nextKind === 'build' && newSession) setNewSession(false)
    onPromptChange?.(value, nextKind)
  }

  // The Global options as one table (#314). Autopilot's default-on lives in `autopilotEnabled`; Eco
  // is disabled + dimmed under Vanilla; the Eco sub-drops show only while Eco is on.
  const mainOptions: OptionRow[] = [
    // Named for the agent actually selected (#948): under Codex, "Raw Claude Code" was a lie.
    { key: 'transparent', label: 'Transparent', description: `Raw ${agentLabel} — turns the whole framework off.`, title: `Fully transparent (#625): run the agent exactly like plain ${agentLabel}, with no framework system prompt, controls, dashboard, guard, or TODO loop. Overrides the options below.`, checked: transparent },
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
      {...(removeContext ? { onMentionRemoved: removeContext } : {})}
      projects={projects}
      files={files}
      presets={presets}
      customPresets={customPresets}
      projectPresets={projectPresets}
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
  const agentModelEl = showAgentModel && (
    <AgentModelMenu
      agents={AGENT_OPTIONS}
      agent={agent}
      model={model}
      onChange={(a, m) => updatePreferences({ agent: a, model: m })}
      busy={busy}
    />
  )
  {/* Presets get a visible surface (#948): load, create and delete in one menu, instead of
      loading only behind typing `/` and deleting off in the options gear. Not in the compact
      row, which has no room and no create panel. */}
  const presetsEl = !compact && (
    <PresetsMenu
      presets={presets}
      customPresets={customPresets}
      projectPresets={projectPresets}
      busy={busy}
      onLoad={loadPresetFromMenu}
      onNew={() => setAddingPreset(true)}
      onDelete={id => updatePreferences({ customPresets: customPresets.filter(p => p.id !== id) })}
      onDeleteProject={id => saveProjectPresetList(projectPresets.filter(p => p.id !== id))}
    />
  )
  // The options gear sits with the agent/model select and submit at the end of the row (#1046), so
  // the three run controls read as one cluster.
  const optionsGearEl = (
    <OptionsMenu
      // In-session (#833): the run options were baked into the session at spawn, so offering
      // them here only rewrote the next session's defaults while reading as session state.
      options={inSession ? [] : mainOptions}
      ecoOptions={inSession ? [] : ecoOptions}
      showEco={!inSession && eco && !ecoDisabled}
      busy={busy}
      {...(inSession ? { label: 'Preferences' } : {})}
      // The "Run on" driver axis (#1050) is baked in at spawn, so it is offered only at the launcher —
      // same reasoning as the agent select being hidden in-session.
      {...(inSession ? {} : { runTarget: { value: target, onChange: (t: RunTarget) => updatePreferences({ target: t }) } })}
      // The saved-devices connection section (#1052) rides the same "Run on" sub, so it too is
      // launcher-only; the header indicator shows the current device everywhere.
      {...(inSession
        ? {}
        : {
            connection: {
              profiles,
              currentUrl,
              isLocal: isLocalConnection,
              onConnect: connectTo,
              onConnectLocal: connectLocal,
              onAddDevice: () => setAddingDevice(true),
            },
          })}
    />
  )

  // The submit is a single icon button that only shows once the prompt has text (#721): an empty
  // launcher has nothing to send, and the arrow reads as "send" in either place (Start session /
  // Send). It is always full size (never appears to grow): it fades in and slides into place, and
  // its layout footprint is animated with a negative margin (0 <- -w) rather than its width, so the
  // control to its left (the agent/model select) is pushed over smoothly. `aria-hidden` while empty
  // keeps it out of the a11y tree and role queries.
  const hasPrompt = !!prompt.trim()
  const submitButton = (
    <Button
      type="submit"
      size="icon-sm"
      onClick={submit}
      disabled={busy || !hasPrompt}
      aria-hidden={!hasPrompt}
      tabIndex={hasPrompt ? undefined : -1}
      aria-label={submitLabel}
      title={busy ? submitBusyLabel : `${submitLabel}  (⌘↵ / Ctrl+Enter)`}
      className={cn(
        // `disabled:opacity-*` overrides the base (the button is disabled while empty/busy), so the
        // hidden state must force it to 0 and the shown state back to full for the busy spinner.
        'h-8 w-8 shrink-0 transition-[margin,opacity,transform] duration-150 ease-out',
        hasPrompt
          ? 'ml-0 translate-x-0 opacity-100 disabled:opacity-100'
          // -2.375rem = the button's own w-8 (2rem) plus the row's gap-1.5 (0.375rem), so a hidden
          // submit leaves the gear flush to the box edge — bottom and right padding stay equal.
          : 'pointer-events-none -ml-[2.375rem] translate-x-2 opacity-0 disabled:opacity-0',
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
    </Button>
  )

  // The "Add a device" modal (#1052), rendered by both forms since the gear is in both. A portal, so
  // its place in the tree does not matter.
  const deviceDialog = addingDevice && <AddDeviceDialog onClose={() => setAddingDevice(false)} onAdded={() => editorRef.current?.focus()} />

  // Compact (#723): a single row for the navbar — editor, then the same controls and submit. It
  // stays one row on purpose (#755): the header must not grow taller to gain them.
  if (compact) {
    return (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{editorEl}</div>
        {agentModelEl}
        {optionsGearEl}
        {submitButton}
        {deviceDialog}
      </div>
    )
  }

  return (
    <>
      {/* The composer box (#721): the editor and its run controls under one rounded border, so the
          prompt and the buttons that act on it read as a single input surface. The editor is
          borderless here (its border moved out to this box); controls sit tucked below it. */}
      <div className="rounded-lg border border-border bg-transparent focus-within:border-muted-foreground/40">
        {editorEl}
        {/* Run controls (#649/#650/#654/#668): presets then the Context picker at the start (#1046),
            the agent+model select, the options gear and submit clustered at the end. */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          {presetsEl}
          {contextControl}
          <div className="ml-auto flex items-center gap-1.5">
            {agentModelEl}
            {optionsGearEl}
            {submitButton}
          </div>
        </div>
      </div>

      {/* The "In play" row (#842/#1046): the Enhanced System Prompt dropdown at the start, the
          resolved-options strip at the end. Off in the compact row (one line) and in-session
          (#833), where the strip described the *global* options rather than this session's. */}
      {!inSession && (
        <div className="mt-2 flex items-center justify-between gap-3">
          {resolvedRowStart}
          <ResolvedOptions options={mainOptions} sources={sources} fileConfig={fileConfig} />
        </div>
      )}

      {addingPreset && (
        <PresetCreatePanel
          currentPrompt={prompt}
          busy={busy}
          canSaveToProject={activeProjectId !== null}
          onCancel={() => {
            setAddingPreset(false)
            editorRef.current?.focus()
          }}
          onSave={(preset, scope) => {
            if (scope === 'project') saveProjectPresetList([...projectPresets, preset])
            else updatePreferences({ customPresets: [...customPresets, preset] })
            setAddingPreset(false)
            editorRef.current?.focus()
          }}
        />
      )}
      {deviceDialog}
    </>
  )
})
