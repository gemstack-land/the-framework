import type { ReactNode } from 'react'
import { AGENTS, AGENT_LABELS } from '@gemstack/the-framework/client'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { DevicesSettings } from './DevicesSettings.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Checkbox } from './ui/checkbox.js'
import { ScrollArea } from './ui/scroll-area.js'

// The settings page (#958): every setting in one place, and the Onboarding checklist.
//
// Until now settings were spread across the header's menus — the composer's gear, the bell, the
// theme toggle — which is fine while you are running something and useless when you are looking
// for one. This is the page the Overview's "you can resume the onboarding on the settings page"
// points at, so the checklist lives here too and is not dismissible.
//
// Everything here writes the GLOBAL tier. `usePreferences`/`updatePreferences` scope themselves to
// the project in the URL, and this route has none (#958 reserves `/settings`), so a value set here
// is the default rather than one repo's override — which is what a settings page should mean. The
// per-project overrides stay where the run is configured, in the launcher's gear.

export function SettingsPage({ onSelectProject }: { onSelectProject?: ((id: string) => void) | undefined; onDone?: () => void }) {
  const preferences = usePreferences()
  const editors = useDetectedEditors()
  const theme = themePreference(preferences)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Your defaults, everywhere. A project can still override its run options from the launcher.
          </p>
        </div>

        <OnboardingChecklist onSelectProject={onSelectProject} />

        <Section title="Appearance">
          <SelectRow
            label="Theme"
            description="Follow the system, or pin light or dark."
            value={theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={value => updatePreferences({ theme: value as ThemePreference })}
          />
          <SelectRow
            label="Editor"
            description="Which editor “Open in editor” launches."
            value={preferences.editor ?? ''}
            options={[
              { value: '', label: 'Auto-detect' },
              ...editors.map(e => ({ value: e.bin, label: e.label })),
            ]}
            onChange={value => updatePreferences({ editor: value })}
          />
        </Section>

        <Section title="Agent">
          <SelectRow
            label="Agent"
            description="Which coding agent runs the work."
            value={preferences.agent ?? AGENTS[0]}
            options={AGENTS.map(a => ({ value: a, label: AGENT_LABELS[a] }))}
            onChange={value => updatePreferences({ agent: value })}
          />
          <TextRow
            label="Model"
            description="Passed through to the agent. Empty uses the agent's own default."
            value={preferences.model ?? ''}
            placeholder="the agent's default"
            onChange={value => updatePreferences({ model: value })}
          />
          <SelectRow
            label="Run on"
            description="Where a session executes: this machine, or a fresh GitHub Actions runner."
            value={preferences.target ?? 'local'}
            options={[
              { value: 'local', label: 'This device' },
              { value: 'actions', label: 'GitHub Actions' },
            ]}
            onChange={value => updatePreferences({ target: value as 'local' | 'actions' })}
          />
        </Section>

        {/* Beside "Run on", since a saved device is the other thing a session can run on. */}
        <DevicesSettings />

        <Section title="Run options">
          <ToggleRow
            label="Transparent"
            description="Run the agent completely raw: no system prompt, no gates, no TODO loop."
            checked={preferences.transparent ?? false}
            onChange={next => updatePreferences({ transparent: next })}
          />
          <ToggleRow
            label="Autopilot"
            description="Auto-accept mode: the agent keeps going instead of stopping to ask."
            checked={preferences.autopilot ?? false}
            onChange={next => updatePreferences({ autopilot: next })}
          />
          <ToggleRow
            label="Technical"
            description="Expose technical detail in what the agent reports back."
            checked={preferences.technical ?? false}
            onChange={next => updatePreferences({ technical: next })}
          />
          <ToggleRow
            label="Vanilla"
            description="Drop the built-in system prompt, keeping the signals the dashboard needs."
            checked={preferences.vanilla ?? false}
            onChange={next => updatePreferences({ vanilla: next })}
          />
          <ToggleRow
            label="Quality follow-ups"
            description="When a session is ready to merge, queue the review passes as TODO entries."
            checked={preferences.onBeforeMergeableQuality ?? false}
            onChange={next => updatePreferences({ onBeforeMergeableQuality: next })}
          />
          <ToggleRow
            label="Browser"
            description="Give the agent a real browser during the run."
            checked={preferences.browser ?? false}
            onChange={next => updatePreferences({ browser: next })}
          />
        </Section>

        <Section title="Eco" description="Drop sections of the system prompt to spend fewer tokens.">
          <ToggleRow
            label="Eco"
            description="The coarse switch: trim the prompt everywhere."
            checked={preferences.eco ?? false}
            onChange={next => updatePreferences({ eco: next })}
          />
          <ToggleRow
            label="Eco: planning"
            description="Trim the planning section."
            checked={preferences.ecoPlanning ?? false}
            onChange={next => updatePreferences({ ecoPlanning: next })}
          />
          <ToggleRow
            label="Eco: research"
            description="Trim the research section."
            checked={preferences.ecoResearch ?? false}
            onChange={next => updatePreferences({ ecoResearch: next })}
          />
          <ToggleRow
            label="Eco: maintenance"
            description="Trim the maintenance section."
            checked={preferences.ecoMaintenance ?? false}
            onChange={next => updatePreferences({ ecoMaintenance: next })}
          />
        </Section>

        <Section title="Notifications">
          <ToggleRow
            label="Browser"
            description="Desktop notifications while the dashboard is open."
            checked={preferences.notifyBrowser ?? true}
            onChange={next => updatePreferences({ notifyBrowser: next })}
          />
          <ToggleRow
            label="Discord"
            description="Deliver to Discord, so notifications reach you with no dashboard open."
            checked={preferences.notifyDiscord ?? false}
            onChange={next => updatePreferences({ notifyDiscord: next })}
          />
          <ToggleRow
            label="Needs you"
            description="A session awaiting your answer, or a PR ready to review."
            checked={preferences.notifyHumanIntervention ?? true}
            onChange={next => updatePreferences({ notifyHumanIntervention: next })}
          />
          <ToggleRow
            label="New activity"
            description="Also ping when a session starts or finishes."
            checked={preferences.notifyNewActivity ?? false}
            onChange={next => updatePreferences({ notifyNewActivity: next })}
          />
          <ToggleRow
            label="Discord bot"
            description="Let Discord messages start and steer sessions."
            checked={preferences.discordBot ?? false}
            onChange={next => updatePreferences({ discordBot: next })}
          />
        </Section>

        <Section title="Automation">
          <ToggleRow
            label="Auto PM"
            description="Start queued work on its own while there is quota left in the week."
            checked={preferences.autoPm ?? false}
            onChange={next => updatePreferences({ autoPm: next })}
          />
          <NumberRow
            label="Spend offset"
            description="How far unattended work sits from the quota boundary, in percentage points. Negative holds it back; positive lets it borrow from the days ahead."
            value={preferences.autoSpendOffset ?? 0}
            onChange={value => updatePreferences({ autoSpendOffset: value })}
          />
        </Section>
      </div>
    </ScrollArea>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">{children}</div>
      </CardContent>
    </Card>
  )
}

function Row({ label, description, control }: { label: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Row
      label={label}
      description={description}
      control={<Checkbox checked={checked} onCheckedChange={next => onChange(next === true)} aria-label={label} />}
    />
  )
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  return (
    <Row
      label={label}
      description={description}
      control={
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-label={label}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      }
    />
  )
}

function TextRow({
  label,
  description,
  value,
  placeholder,
  onChange,
}: {
  label: string
  description: string
  value: string
  placeholder?: string
  onChange: (next: string) => void
}) {
  return (
    <Row
      label={label}
      description={description}
      control={
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          aria-label={label}
          className="w-48 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      }
    />
  )
}

function NumberRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <Row
      label={label}
      description={description}
      control={
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value) || 0)}
          aria-label={label}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      }
    />
  )
}
