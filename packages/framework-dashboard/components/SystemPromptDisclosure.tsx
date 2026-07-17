import { useState } from 'react'
import { composeRunSystem, type EcoOptions } from '@gemstack/framework/client'
import { DisclosureToggle } from './DisclosureToggle.js'

/**
 * "See actual prompt sent" (#520): the built-in system prompt, shown in full,
 * before the run — so a user can read what The Framework wraps their prompt in
 * rather than take our word for it.
 *
 * It renders through `composeRunSystem`, the same function the run itself composes
 * with, so the toggles above it are shown doing exactly what they really do. That
 * is the whole point: no second copy of the wrapping logic to drift from the real
 * one.
 *
 * Since #547 nothing is read off disk and appended at run time, so this is the
 * whole prompt for every run kind, not a preview of most of it.
 */
export function SystemPromptDisclosure({
  prompt,
  disabled,
  onDisabledChange,
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
  autopilot: boolean
  eco: EcoOptions | undefined
  context: string[]
  busy: boolean
}) {
  const [open, setOpen] = useState(false)

  const text = composeRunSystem({
    antiLazyPill: !disabled,
    tf: { prompt, params: { autopilot, ...(eco ? { eco } : {}) } },
    ...(context.length ? { context } : {}),
  })

  return (
    <div className="mt-3 text-xs">
      <DisclosureToggle open={open} onToggle={() => setOpen(o => !o)}>
        See actual prompt sent (see system prompt)
      </DisclosureToggle>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-border p-3 text-muted-foreground">
          <p>
            The Framework wraps your prompt with a so-called &quot;system prompt&quot; (it&apos;s just a prompt wrapping
            your prompt) in order to enable long-running autonomous agents.
          </p>

          <label className="flex w-fit cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={disabled} onChange={e => onDisabledChange(e.target.checked)} disabled={busy} />{' '}
            Disable system prompt (caveat: some functionalities might not work)
          </label>

          {text ? (
            <>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-foreground">
                {text}
              </pre>
              <p>
                {text.length.toLocaleString()} characters. This is the whole system prompt: nothing else is appended
                when the run starts.
              </p>
            </>
          ) : (
            <p className="text-foreground">
              The system prompt is off: your prompt is sent to the agent exactly as you wrote it, with nothing wrapped
              around it.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
