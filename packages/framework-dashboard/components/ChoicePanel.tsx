import { useEffect, useRef, useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { sendChoice } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
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
  runId,
  choice,
  active = false,
}: {
  projectId: string
  /** Which run the pick resolves (#749); absent falls back to the project's control log. */
  runId?: string | null | undefined
  choice: ChoiceRequest
  active?: boolean
}) {
  const { busy, error, run } = useAction()
  // Posted and accepted by the daemon; the panel stays parked (buttons off, status shown)
  // until the `choice-resolved` event unmounts it (#948) — before, the buttons just greyed
  // out with no word on why.
  const [sent, setSent] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []),
  )
  // The countdown's auto-accept fires from a closure captured when the countdown started;
  // the ref keeps it reading the boxes as they are at fire time (#948).
  const checkedRef = useRef(checked)
  checkedRef.current = checked
  const autopilot = autopilotEnabled(usePreferences())
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const parked = busy || sent

  const post = (pick: string | string[], by: 'user' | 'autopilot' = 'user') => {
    void run(() => sendChoice(projectId, choice.id, pick, by, runId ?? undefined), 'Could not send your choice — try again.').then(
      result => {
        if (result !== undefined) setSent(true)
      },
    )
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
  const autoPick = (): string | string[] => (choice.multi ? [...checkedRef.current] : (approveId ?? ''))
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !parked) {
        e.preventDefault()
        accept()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, parked])

  // The countdown: tick down once a second while autopilot is on and uncancelled, then
  // auto-accept. Restarts if autopilot is toggled back on before a pick is made.
  useEffect(() => {
    if (!autopilot || cancelled || parked) {
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
  }, [autopilot, cancelled, parked])

  const toggleAutopilot = (on: boolean) => updatePreferences({ autopilot: on }) // shared with the Start form (#410)

  return (
    <section role="region" aria-label={choice.title} className="border-b border-border bg-accent/40 p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your call</div>
      <h2 className="mb-3 text-sm font-medium">{choice.title}</h2>

      {choice.confirm ? (
        <div className="flex gap-2">
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-600 hover:opacity-90"
            disabled={parked || !approveId}
            onClick={() => approveId && post(approveId)}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-500"
            disabled={parked || !declineId}
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
                  <input type="checkbox" className="mt-1" checked={checked.has(o.id)} onChange={() => toggle(o.id)} disabled={parked} />
                  <span>
                    {o.label}
                    {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {/* The label says what Accept will post, so an empty pick is a choice, not a surprise. */}
          <Button disabled={parked} onClick={() => post([...checked])}>
            {checked.size === 0 ? 'Accept none' : `Accept ${checked.size} selected`}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {choice.options.map(o => (
            <Button
              key={o.id}
              variant={o.id === choice.recommended ? 'default' : 'outline'}
              className={cn('h-auto flex-col items-start gap-0.5 py-2 text-left')}
              disabled={parked}
              onClick={() => post(o.id)}
            >
              <span className="font-medium">
                {o.label}
                {o.id === choice.recommended && <span className="ml-2 text-xs font-normal opacity-80">Recommended</span>}
              </span>
              {o.detail && <span className="text-xs font-normal opacity-80">{o.detail}</span>}
            </Button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        {parked ? (
          <span role="status">{busy ? 'Sending your choice…' : 'Choice sent — waiting for the session to pick it up…'}</span>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={autopilot} onChange={e => toggleAutopilot(e.target.checked)} /> Autopilot
            </label>
            {autopilot && (
              <span className={cn(secondsLeft !== null && !cancelled && 'font-medium text-foreground')}>
                {cancelled
                  ? 'Auto accept canceled — pick manually'
                  : secondsLeft !== null && `● Auto accept in ${secondsLeft}s — move the mouse to cancel`}
              </span>
            )}
            {active && <span className="ml-auto">Ctrl+Enter to accept</span>}
          </>
        )}
      </div>
    </section>
  )
}
