import { useState } from 'react'
import type { DashboardData, OnboardingSuggestion } from '@gemstack/the-framework'
import { presets } from '@gemstack/the-framework/client'
import { Check, Circle, X } from 'lucide-react'
import { onDashboard } from '../server/reads.telefunc.js'
import { onOnboarding, sendAddProject } from '../server/projects.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { usePreferences, updatePreferences, notificationsEnabled } from '../lib/preferences.js'
import { useNotifyChannels, reloadNotifyChannels } from '../lib/notify-channels.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { useStartRun } from '../lib/use-start-run.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { DiscordBotDialog, DiscordWebhookDialog, DISCORD_BOT_DESCRIPTION, DISCORD_WEBHOOK_DESCRIPTION } from './DiscordDialogs.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'

// The Onboarding checklist (#958): the integrations a new install needs, each with the state it
// is actually in rather than a static list to read past.
//
// Every "done" is derived from a real fact — a registered project, a non-empty queue, a ticket on
// disk, a granted browser permission, a daemon that holds the Discord credentials — so a step
// cannot be ticked by clicking it, and a step done outside the dashboard shows up ticked anyway.
//
// It renders in two places: the Overview, where it can be dismissed, and the settings page, where
// it cannot — that is what dismissing it promises you can come back to.

/** One checklist row: what it is, whether it is done, and what to do about it. */
interface Step {
  key: string
  label: string
  description: string
  done: boolean
  /** The action(s) offered while it is not done. */
  action?: React.ReactNode
}

export function OnboardingChecklist({
  dismissible = false,
  onSelectProject,
}: {
  /** The Overview offers to hide it; the settings page always shows it. */
  dismissible?: boolean
  onSelectProject?: ((id: string) => void) | undefined
}) {
  // Slower than the Overview's own 5s poll: onboarding state changes at human speed, and this
  // read fans out over every project to answer the tickets question.
  const { value: data, reload } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [])
  const { value: suggestion, reload: reloadSuggestion } = usePolled<OnboardingSuggestion | null>(onOnboarding, null, 30_000, [])
  // Shared with the settings rows and the bell (#1095): a credential saved in a dialog below has
  // to tick its row here too, and a second poll of the same fact is how those two disagree.
  const channels = useNotifyChannels()
  const preferences = usePreferences()
  const permission = useNotificationPermission()
  const { start, busy: starting, error: startError } = useStartRun()

  const [addingProject, setAddingProject] = useState(false)
  const [addingCwd, setAddingCwd] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [discordBotOpen, setDiscordBotOpen] = useState(false)
  const [discordWebhookOpen, setDiscordWebhookOpen] = useState(false)

  // The project onboarding acts on: the one this server runs in when it is registered, else the
  // only/most recent one. Onboarding is a first-run flow, so there is rarely a second candidate.
  const targetProjectId = suggestion?.cwdProjectId ?? data?.projects[0]?.projectId ?? null

  const projectCount = data?.totals.projects ?? 0
  const hasTickets = data?.projects.some(p => p.hasTickets) ?? false
  const browserGranted = permission === 'granted' && notificationsEnabled(preferences)

  const addCwd = async () => {
    if (!suggestion?.cwd) return
    setAddingCwd(true)
    setAddError(null)
    const result = await sendAddProject(suggestion.cwd, false).catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
    setAddingCwd(false)
    if (!result.ok) {
      setAddError(result.error)
      return
    }
    reload()
    reloadSuggestion()
  }

  const enableBrowserNotifications = () => {
    updatePreferences({ notifyBrowser: true })
    // Asking for permission must ride this user gesture.
    if (permission === 'default') void Notification.requestPermission()
  }

  const importTickets = async () => {
    if (!targetProjectId) return
    const started = await start(targetProjectId, presets.importTickets.render(), 'prompt', {})
    // The import runs as a session; follow it, since that is where its output appears.
    if (started) onSelectProject?.(targetProjectId)
  }

  const steps: Step[] = [
    {
      key: 'project',
      label: 'Add a project',
      description: 'A project is a git repo The Framework may work in.',
      done: projectCount > 0,
      action: (
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-2">
            {suggestion?.cwd && !suggestion.cwdProjectId && (
              <Button size="sm" onClick={addCwd} disabled={addingCwd} title={suggestion.cwd}>
                {addingCwd ? 'Adding…' : `Add ${suggestion.cwd} as project`}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setAddingProject(true)}>
              Select &amp; add project directory
            </Button>
          </div>
          {addError && <span className="text-xs text-destructive">{addError}</span>}
        </div>
      ),
    },
    {
      key: 'todos',
      label: 'Populate the queue of AI tasks',
      description:
        'TODO_AGENTS.md is the queue: each unchecked item is work the agent picks up on its own, so a filled queue is what lets it keep going without you.',
      done: (data?.totals.openTodos ?? 0) > 0,
    },
    {
      key: 'tickets',
      label: 'Populate tickets/',
      description:
        'tickets/ holds the bigger things to work on, in the repo. The agent plans and spikes from them, and they are the input the queue is filled from.',
      done: hasTickets,
      action: (
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" onClick={importTickets} disabled={!targetProjectId || starting}>
            {starting ? 'Starting…' : 'Import tickets from GitHub'}
          </Button>
          {!targetProjectId && <span className="text-xs text-muted-foreground">Add a project first</span>}
          {startError && <span className="text-xs text-destructive">{startError}</span>}
        </div>
      ),
    },
    {
      key: 'discord-bot',
      label: 'Add the Discord bot',
      description: DISCORD_BOT_DESCRIPTION,
      done: channels?.discordBot ?? false,
      action: (
        <Button size="sm" variant="outline" onClick={() => setDiscordBotOpen(true)}>
          Set up the bot
        </Button>
      ),
    },
    {
      key: 'browser-notification',
      label: 'Add browser notifications',
      description: 'Desktop pings while the dashboard is open, so a session waiting on you does not sit unnoticed.',
      done: browserGranted,
      action:
        permission === 'denied' ? (
          <span className="text-xs text-muted-foreground">Blocked in your browser settings</span>
        ) : permission === 'unsupported' ? (
          <span className="text-xs text-muted-foreground">Not supported by this browser</span>
        ) : (
          <Button size="sm" variant="outline" onClick={enableBrowserNotifications}>
            Enable
          </Button>
        ),
    },
    {
      key: 'discord-notification',
      label: 'Add Discord notifications',
      description: DISCORD_WEBHOOK_DESCRIPTION,
      done: channels?.discordWebhook ?? false,
      action: (
        <Button size="sm" variant="outline" onClick={() => setDiscordWebhookOpen(true)}>
          Add the webhook
        </Button>
      ),
    },
  ]

  const doneCount = steps.filter(s => s.done).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Onboarding</CardTitle>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {steps.length} set up.
          </p>
        </div>
        {dismissible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updatePreferences({ onboardingDismissed: true })}
            title="Remove, you can resume the onboarding on the settings page"
            aria-label="Remove, you can resume the onboarding on the settings page"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {steps.map(step => (
            <li key={step.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-start gap-3">
                {step.done ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                )}
                <div className="min-w-0">
                  <p className={step.done ? 'text-sm text-muted-foreground line-through' : 'text-sm'}>{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
              {!step.done && step.action && <div className="shrink-0">{step.action}</div>}
            </li>
          ))}
        </ul>
      </CardContent>

      {addingProject && (
        <AddProjectPanel
          onAdded={() => {
            reload()
            reloadSuggestion()
          }}
          onClose={() => setAddingProject(false)}
        />
      )}
      <DiscordBotDialog
        open={discordBotOpen}
        onOpenChange={setDiscordBotOpen}
        channels={channels}
        onSaved={reloadNotifyChannels}
      />
      <DiscordWebhookDialog
        open={discordWebhookOpen}
        onOpenChange={setDiscordWebhookOpen}
        channels={channels}
        onSaved={reloadNotifyChannels}
      />
    </Card>
  )
}
