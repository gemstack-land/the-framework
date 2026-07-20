import { useState } from 'react'
import { composeRunSystem, type EcoOptions } from '@gemstack/framework/client'
import { DisclosureToggle } from './DisclosureToggle.js'

/**
 * "Enhanced System Prompt" (#863, was "See actual prompt sent" #520): the built-in system
 * prompt, shown in full, before the run — so a user can read what The Framework wraps their
 * prompt in rather than take our word for it.
 *
 * It renders through `composeRunSystem`, the same function the run itself composes
 * with, so the toggles above it are shown doing exactly what they really do. That
 * is the whole point: no second copy of the wrapping logic to drift from the real
 * one.
 *
 * Since #547 nothing is read off disk and appended at run time, so this is the
 * whole prompt for every run kind, not a preview of most of it.
 *
 * The two rows are the two axes the composer already has, not new settings: the #326
 * built-in block (`vanilla`, inverted) and the framework integration as a whole
 * (`transparent`, inverted — with that off the channel is empty and the agent runs as raw
 * `claude -p`, #625). They write the same preferences the session-options gear does, so the
 * two surfaces cannot disagree about what this run will send.
 */
export function SystemPromptDisclosure({
  prompt,
  disabled,
  onDisabledChange,
  transparent,
  onTransparentChange,
  browser,
  autopilot,
  eco,
  context,
  busy,
}: {
  /** What the user has typed. It rides inside the prompt, so it shapes the preview. */
  prompt: string
  /** The Vanilla toggle (#314), under its real name. */
  disabled: boolean
  onDisabledChange: (value: boolean) => void
  /** Transparent mode (#625): the whole channel is empty, so the preview shows nothing wrapped. */
  transparent?: boolean
  /** Omitted where the integration is not the caller's to switch; the row then reads as fixed. */
  onTransparentChange?: (value: boolean) => void
  /** The browser section rides with the protocols, so it is part of the prompt the run sends. */
  browser?: boolean
  autopilot: boolean
  eco: EcoOptions | undefined
  context: string[]
  busy: boolean
}) {
  const [open, setOpen] = useState(false)

  const text = composeRunSystem({
    antiLazyPill: !disabled,
    ...(transparent ? { transparent: true } : {}),
    ...(browser ? { browser: true } : {}),
    tf: { prompt, params: { autopilot, ...(eco ? { eco } : {}) } },
    ...(context.length ? { context } : {}),
  })

  // Transparent is the master off-switch, so it turns the built-in block off whatever
  // `vanilla` says — the row has to read the way the run will actually behave.
  const antiLazyOn = !disabled && !transparent
  const integrationOn = !transparent
  // ✅ only when *completely* enabled (#863): either axis off is a ❌, even though a run with
  // only the built-in block off still sends the emit protocols.
  const fullyOn = antiLazyOn && integrationOn

  return (
    <div className="mt-3 text-xs">
      <DisclosureToggle open={open} onToggle={() => setOpen(o => !o)}>
        <span aria-hidden>{fullyOn ? '✅' : '❌'}</span> Enhanced System Prompt
        <span className="sr-only">{fullyOn ? ' (fully enabled)' : ' (not fully enabled)'}</span>
      </DisclosureToggle>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-border p-3 text-muted-foreground">
          <p>
            The Framework wraps your prompt with a so-called &quot;system prompt&quot; (it&apos;s just a prompt wrapping
            your prompt) in order to enable long-running autonomous agents.
          </p>

          <label className="flex w-fit cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={antiLazyOn}
              onChange={e => onDisabledChange(!e.target.checked)}
              disabled={busy || transparent}
              title={transparent ? 'Off while the framework integration is off' : undefined}
            />{' '}
            Anti-laziness and improved large-scope planning
          </label>

          <label className="flex w-fit cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={integrationOn}
              onChange={e => onTransparentChange?.(!e.target.checked)}
              disabled={busy || !onTransparentChange}
            />{' '}
            Integration with The Framework (⚠️ Some functionalities won&apos;t work)
          </label>

          {text ? (
            <>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-foreground">
                {text}
              </pre>
              <p>
                {text.length.toLocaleString()} characters. This is the whole system prompt: nothing else is appended
                when the session starts.
              </p>
            </>
          ) : (
            <p className="text-foreground">
              No extra system prompt: only the built-in system prompt of your AI model provider.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
