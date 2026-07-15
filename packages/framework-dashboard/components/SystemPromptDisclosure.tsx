import { useState } from 'react'
import { composeRunSystem, type EcoOptions } from '@gemstack/framework/client'

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
 * What it honestly cannot show is the rest of a build run's prompt. Personas,
 * skills, the detected preset and the repo's own memory files are read off disk
 * and appended at run time, and on a build run they can dwarf this block. So the
 * caveat below says so, and the run's own `system-prompt` event carries the true
 * final text into the event log the moment a run starts.
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
    <div className="mt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer text-muted-foreground hover:text-foreground"
      >
        {open ? '▾' : '▶'} See actual prompt sent (see system prompt)
      </button>

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
                {text.length.toLocaleString()} characters. A build run also appends this project&apos;s memory files and
                the personas and skills for its detected stack, which are read at run time — the run&apos;s{' '}
                <code>system prompt</code> entry in the event log below carries the final text in full.
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
