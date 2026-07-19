import { useEffect, useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { sendChoice } from '../server/control.telefunc.js'
import { usePreferences, updatePreferences, autopilotEnabled } from '../lib/preferences.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// "Your call" — the interactive gate the run parks on (#304/#332), rendered from the
// live event stream and posted back over Telefunc (server/control.telefunc.ts) to the
// project's control.jsonl. Three shapes: an Approve/Decline confirm (#358), a
// multi-select checklist (#332), and the single-select list (#304). When Autopilot is on
// it auto-accepts the recommended pick after a countdown (#433), which any mouse movement
// cancels. The panel clears itself when the resulting `choice-resolved` event streams in
// (pendingChoices drops it); mount it with `key={choice.id}` so a re-fired gate resets state.
// `active` (the first gate in the right rail, #440) binds Ctrl+Enter to Accept.
export function ChoicePanel({
  projectId,
  choice,
  active = false,
}: {
  projectId: string
  choice: ChoiceRequest
  active?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []),
  )
  const autopilot = autopilotEnabled(usePreferences())
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const post = (pick: string | string[], by: 'user' | 'autopilot' = 'user') => {
    setBusy(true)
    setError(null)
    void sendChoice(projectId, choice.id, pick, by).catch(() => {
      setBusy(false)
      setError('Could not send your choice — try again.')
    })
  }

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const approveId = choice.recommended ?? choice.options[0]?.id
  const declineId = choice.options.find(o => o.id !== approveId)?.id ?? approveId

  // What Accept picks: the checked subset for a multi-select, else the recommended option
  // (an Approve for a confirm gate). Shared by the button, the countdown, and Ctrl+Enter.
  const autoPick = (): string | string[] => (choice.multi ? [...checked] : (approveId ?? ''))
  const accept = (by: 'user' | 'autopilot' = 'user') => post(autoPick(), by)

  // Any mouse movement cancels the auto-accept — the human is here, so let them pick.
  useEffect(() => {
    const cancel = () => setCancelled(true)
    window.addEventListener('mousemove', cancel, { once: true })
    return () => window.removeEventListener('mousemove', cancel)
  }, [])

  // Ctrl+Enter accepts the recommended pick (page.ts parity, #440). Only the active gate
  // (the first in the rail) binds it, so the shortcut is unambiguous with several gates open.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busy) {
        e.preventDefault()
        accept()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, busy, checked])

  // The countdown: tick down once a second while autopilot is on and uncancelled, then
  // auto-accept. Restarts if autopilot is toggled back on before a pick is made.
  useEffect(() => {
    if (!autopilot || cancelled || busy) {
      setSecondsLeft(null)
      return
    }
    let left = Math.ceil((choice.autoAcceptMs ?? 10000) / 1000)
    setSecondsLeft(left)
    const timer = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(timer)
        setSecondsLeft(null)
        accept('autopilot')
      } else {
        setSecondsLeft(left)
      }
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilot, cancelled, busy])

  const toggleAutopilot = (on: boolean) => updatePreferences({ autopilot: on }) // shared with the Start form (#410)

  return (
    <section className="border-b border-border bg-accent/40 p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your call</div>
      <h2 className="mb-3 text-sm font-medium">{choice.title}</h2>

      {choice.confirm ? (
        <div className="flex gap-2">
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-600 hover:opacity-90"
            disabled={busy || !approveId}
            onClick={() => approveId && post(approveId)}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-500"
            disabled={busy || !declineId}
            onClick={() => declineId && post(declineId)}
          >
            Decline
          </Button>
        </div>
      ) : choice.multi ? (
        <>
          <ul className="mb-3 space-y-1">
            {choice.options.map(o => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={checked.has(o.id)} onChange={() => toggle(o.id)} disabled={busy} />
                  <span>
                    {o.label}
                    {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button disabled={busy} onClick={() => post([...checked])}>
            Accept
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {choice.options.map(o => (
            <Button
              key={o.id}
              variant={o.id === choice.recommended ? 'default' : 'outline'}
              className={cn('h-auto flex-col items-start gap-0.5 py-2 text-left')}
              disabled={busy}
              onClick={() => post(o.id)}
            >
              <span className="font-medium">{o.label}</span>
              {o.detail && <span className="text-xs font-normal opacity-80">{o.detail}</span>}
            </Button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={autopilot} onChange={e => toggleAutopilot(e.target.checked)} disabled={busy} /> Autopilot
        </label>
        {autopilot && !busy && (
          <span>
            {cancelled
              ? 'Auto accept canceled — pick manually'
              : secondsLeft !== null && `● Auto accept in ${secondsLeft}s — move the mouse to cancel`}
          </span>
        )}
        {active && !busy && <span className="ml-auto">Ctrl+Enter to accept</span>}
      </div>
    </section>
  )
}
