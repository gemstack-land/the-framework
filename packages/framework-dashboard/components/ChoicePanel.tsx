import { useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { sendChoice } from '../server/control.telefunc.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// "Your call" — the interactive gate the run parks on (#304/#332), rendered from the
// live event stream and posted back over Telefunc (server/control.telefunc.ts) to the
// project's control.jsonl. Three shapes: an Approve/Decline confirm (#358), a
// multi-select checklist (#332), and the single-select list (#304). The panel clears
// itself when the resulting `choice-resolved` event streams in (pendingChoice drops
// it); mount it with `key={choice.id}` so a re-fired gate resets local state.
export function ChoicePanel({ projectId, choice }: { projectId: string; choice: ChoiceRequest }) {
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []),
  )

  const post = (pick: string | string[]) => {
    setBusy(true)
    void sendChoice(projectId, choice.id, pick).catch(() => setBusy(false))
  }

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const approveId = choice.recommended ?? choice.options[0]?.id
  const declineId = choice.options.find(o => o.id !== approveId)?.id ?? approveId

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
    </section>
  )
}
