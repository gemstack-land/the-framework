import { useState, type ReactNode } from 'react'
import type { Preferences } from '@gemstack/the-framework'
import { AGENTS, AGENT_LABELS, MAX_SPEND_OFFSET } from '@gemstack/the-framework/client'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { runOptionRows, type OptionRow } from '../lib/run-option-rows.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { useNotifyChannels, reloadNotifyChannels } from '../lib/notify-channels.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { DevicesSettings } from './DevicesSettings.js'
import { DiscordBotDialog, DiscordWebhookDialog } from './DiscordDialogs.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Button } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'
import { ScrollArea } from './ui/scroll-area.js'
import { cn } from '../lib/utils.js'

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
  // One shared table with the launcher (#958), rules already applied.
  const { main: runOptions, eco: ecoRows } = runOptionRows(preferences)
  // A notification toggle is a preference; whether it can deliver is a capability (#948). Both are
  // shown, the same way the bell does, so a row cannot promise delivery that will not happen.
  const permission = useNotificationPermission()
  // Shared with the checklist above and the bell (#1095), so a credential saved in one of the
  // setup dialogs settles every one of them at once rather than each on its own timer.
  const channels = useNotifyChannels()
  const webhookReady = channels === null || channels.discordWebhook
  const botReady = channels === null || channels.discordBot
  const browserBlocked = permission === 'denied'
  const [discordBotOpen, setDiscordBotOpen] = useState(false)
  const [discordWebhookOpen, setDiscordWebhookOpen] = useState(false)

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

        {/* The same table the launcher renders (#958), so a rule cannot hold in one place and
            not the other: Transparent overrides the rest, Eco is inert once the system prompt is
            off, Browser is Claude-only, and the Eco drops need Eco. A row the rules disable is
            shown greyed with its reason rather than hidden, since this is where you come to look. */}
        <Section
          title="Run options"
          description="What a new session starts with. The launcher can still change them for one session."
        >
          {runOptions.map(row => (
            <OptionToggleRow key={row.key} row={row} />
          ))}
        </Section>

        <Section title="Eco" description="Drop sections of the system prompt to spend fewer tokens.">
          {ecoRows.map(row => (
            <OptionToggleRow key={row.key} row={row} />
          ))}
        </Section>

        <Section title="Notifications">
          <ToggleRow
            label="Browser"
            description={
              browserBlocked
                ? 'Blocked in your browser settings'
                : 'Desktop notifications while the dashboard is open.'
            }
            checked={(preferences.notifyBrowser ?? true) && !browserBlocked}
            disabled={browserBlocked}
            onChange={next => updatePreferences({ notifyBrowser: next })}
          />
          <ToggleRow
            label="Discord"
            description={
              webhookReady
                ? 'Deliver to Discord, so notifications reach you with no dashboard open.'
                : 'Not configured — no webhook is set on the daemon'
            }
            checked={preferences.notifyDiscord ?? false}
            onChange={next => updatePreferences({ notifyDiscord: next })}
            action={
              <Button variant="outline" size="sm" onClick={() => setDiscordWebhookOpen(true)}>
                {channels?.discordWebhook ? 'Webhook' : 'Set up'}
              </Button>
            }
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
            description={
              botReady
                ? 'Let Discord messages start and steer sessions.'
                : 'Not configured — no bot token is set on the daemon'
            }
            checked={preferences.discordBot ?? false}
            onChange={next => updatePreferences({ discordBot: next })}
            action={
              <Button variant="outline" size="sm" onClick={() => setDiscordBotOpen(true)}>
                {channels?.discordBot ? 'Bot token' : 'Set up'}
              </Button>
            }
          />
        </Section>

        <Section title="Automation">
          <ToggleRow
            label="Auto PM"
            description="Start queued work on its own while there is quota left in the week."
            checked={preferences.autoPm ?? false}
            onChange={next => updatePreferences({ autoPm: next })}
          />
          {/* Bounded to the same ±MAX_SPEND_OFFSET the slider and the sanitizer use (#960). Without
              it a typed 9999 was clamped to 50 on save while the box kept showing 9999. */}
          <NumberRow
            label="Spend offset"
            description={`How far unattended work sits from the quota boundary, in percentage points (max ${MAX_SPEND_OFFSET}). Negative holds it back; positive lets it borrow from the days ahead.`}
            value={preferences.autoSpendOffset ?? 0}
            min={-MAX_SPEND_OFFSET}
            max={MAX_SPEND_OFFSET}
            onChange={value => updatePreferences({ autoSpendOffset: value })}
          />
        </Section>
      </div>

      <DiscordBotDialog open={discordBotOpen} onOpenChange={setDiscordBotOpen} channels={channels} onSaved={reloadNotifyChannels} />
      <DiscordWebhookDialog
        open={discordWebhookOpen}
        onOpenChange={setDiscordWebhookOpen}
        channels={channels}
        onSaved={reloadNotifyChannels}
      />
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

function Row({
  label,
  description,
  control,
  dimmed = false,
}: {
  label: string
  description: string
  control: ReactNode
  /** A row the rules turned off: greyed, but still shown with its reason. */
  dimmed?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className={cn('text-sm', dimmed && 'text-muted-foreground')}>{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

/**
 * One row of the shared run-option table (#958).
 *
 * A row the rules disable keeps its place and shows *why* instead of vanishing, because the whole
 * point of this page is to be where you look for a setting. `row.checked` is the effective value,
 * so an option Transparent overrides reads off here exactly as it does in the launcher.
 */
function OptionToggleRow({ row }: { row: OptionRow }) {
  const disabled = row.disabled ?? false
  return (
    <Row
      label={row.label}
      description={(disabled ? row.disabledReason : row.description) ?? row.description ?? ''}
      dimmed={disabled}
      control={
        <Checkbox
          checked={row.checked}
          disabled={disabled}
          onCheckedChange={next => updatePreferences({ [row.key]: next === true } as Partial<Preferences>)}
          aria-label={row.label}
        />
      }
    />
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  action,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  /** A capability the daemon or browser withholds, e.g. notifications the browser has blocked. */
  disabled?: boolean
  /** What supplies the capability the toggle needs (#1095): the Discord rows open their setup dialog. */
  action?: ReactNode
}) {
  return (
    <Row
      label={label}
      description={description}
      dimmed={disabled}
      control={
        <span className="flex items-center gap-2">
          {action}
          <Checkbox
            checked={checked}
            disabled={disabled}
            onCheckedChange={next => onChange(next === true)}
            aria-label={label}
          />
        </span>
      }
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
  min,
  max,
  onChange,
}: {
  label: string
  description: string
  value: number
  min: number
  max: number
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
          min={min}
          max={max}
          // Clamped here as well as on the input: `min`/`max` only constrain the spinner, so a typed
          // value still has to be held to the range the sanitizer will enforce anyway (#960).
          onChange={e => onChange(Math.min(Math.max(Math.round(Number(e.target.value) || 0), min), max))}
          aria-label={label}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      }
    />
  )
}
