import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DriverEvent } from './types.js'

// The pieces every driver session needs but that are not agent-specific: emitting events
// without letting a listener throw into the run, folding the session + per-call signals and
// framing, and reading a workspace file. The agent-specific parts (argv, the output parser,
// how framing is delivered) stay in each driver; these do not, so a second driver reuses
// them rather than copying them.

/**
 * A {@link DriverStartOptions.onEvent} caller that never lets a listener throw into the
 * driver — a throwing dashboard handler must not abort the agent run. An absent `onEvent`
 * is a no-op. `agent` names the driver in the swallow log so a thrown handler stays traceable.
 */
export function makeEmit(onEvent: ((event: DriverEvent) => void) | undefined, agent: string): (event: DriverEvent) => void {
  if (!onEvent) return () => {}
  return event => {
    try {
      onEvent(event)
    } catch (err) {
      console.error(`[framework] ${agent} onEvent threw; ignoring:`, err)
    }
  }
}

/** The live AbortSignals for a prompt — the session's and the per-call one, minus the absent. */
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal[] {
  return signals.filter((s): s is AbortSignal => s != null)
}

/** Fold a session's framing and a per-call system prompt into one blank-line-separated block. */
export function combineFraming(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('\n\n')
}

/** Read a workspace file relative to the session cwd — the driver's `readCode`. */
export function readWorkspaceFile(cwd: string, path: string): Promise<string> {
  return readFile(resolve(cwd, path), 'utf8')
}
