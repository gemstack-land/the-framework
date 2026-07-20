/**
 * What a Discord message should do (#680). Pure: it takes the text plus a snapshot of the
 * project's state and returns an action, so every routing rule is unit-testable without a
 * gateway, a daemon, or a run. The side effects live in `bot.ts`.
 */

/** One option of a parked choice gate, as the run emitted it. */
export interface GateOption {
  id: string
  label: string
}

/** A gate a run is parked on, waiting for an answer. */
export interface Gate {
  id: string
  title: string
  options: GateOption[]
  /** A multi-select gate takes a list of picks rather than one. */
  multi?: boolean
}

/** The live run of a project, if it has one. */
export interface RunSnapshot {
  projectId: string
  runId: string
  /** Present when the run is parked on a choice gate. */
  gate?: Gate
}

/** Where a message goes when no run is live. */
export interface ProjectTarget {
  id: string
  name: string
}

/** The state a routing decision is made against. */
export interface RouteContext {
  /** The project's live run, if any. */
  live?: RunSnapshot | undefined
  /** The project a new run would start in. */
  target: ProjectTarget
}

/** What the bot should do about a message. */
export type BotAction =
  | { kind: 'choice'; projectId: string; runId: string; gateId: string; pick: string | string[]; reply: string }
  | { kind: 'message'; projectId: string; runId: string; text: string; reply: string }
  | { kind: 'start'; projectId: string; text: string; reply: string }
  | { kind: 'stop'; projectId: string; runId: string; reply: string }
  /** Nothing to do but say something (help, status, an unusable message). */
  | { kind: 'reply'; reply: string }

/** The help text, also sent when a message cannot be understood as an answer to a gate. */
export const HELP = [
  'The Framework, at your service:',
  '· send anything else to start a session, or to message the one already running',
  '· `!status` — what is running right now',
  '· `!stop` — stop the running session',
  '· `!help` — this',
  'When a session asks a question, reply with the option number.',
].join('\n')

/** Render a parked gate as a numbered question, so it can be answered by number in chat. */
export function renderGate(gate: Gate): string {
  const lines = [`**${gate.title}**`]
  gate.options.forEach((option, index) => lines.push(`${index + 1}. ${option.label}`))
  lines.push(gate.multi ? '_Reply with the numbers, e.g. `1,3`._' : '_Reply with the number._')
  return lines.join('\n')
}

/**
 * Resolve an answer to a gate. Accepts option numbers (`2`, or `1,3` for a multi-select) and an
 * exact option label or id, case-insensitively. `undefined` when the text is not an answer —
 * the caller then treats it as an ordinary message rather than guessing, because picking the
 * wrong option on someone's behalf is worse than asking again.
 */
export function resolvePick(gate: Gate, text: string): string | string[] | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const parts = gate.multi ? trimmed.split(',').map(part => part.trim()).filter(Boolean) : [trimmed]
  const picked: string[] = []
  for (const part of parts) {
    const byNumber = /^\d+$/.test(part) ? gate.options[Number(part) - 1] : undefined
    const byName = gate.options.find(
      option => option.label.toLowerCase() === part.toLowerCase() || option.id.toLowerCase() === part.toLowerCase(),
    )
    const option = byNumber ?? byName
    if (!option) return undefined
    picked.push(option.id)
  }
  if (picked.length === 0) return undefined
  return gate.multi ? picked : picked[0]
}

/** Decide what a message means. See the module comment. */
export function decideAction(text: string, ctx: RouteContext): BotAction {
  const trimmed = text.trim()
  const command = trimmed.toLowerCase()

  if (command === '!help') return { kind: 'reply', reply: HELP }

  if (command === '!status') {
    if (!ctx.live) return { kind: 'reply', reply: `Nothing running in **${ctx.target.name}**.` }
    const running = `Running in **${ctx.target.name}** (\`${ctx.live.runId}\`).`
    return { kind: 'reply', reply: ctx.live.gate ? `${running}\n\n${renderGate(ctx.live.gate)}` : running }
  }

  if (command === '!stop') {
    if (!ctx.live) return { kind: 'reply', reply: 'Nothing to stop.' }
    return { kind: 'stop', projectId: ctx.live.projectId, runId: ctx.live.runId, reply: 'Stopping the session.' }
  }

  // A parked run is asking something, so read the message as the answer first.
  if (ctx.live?.gate) {
    const gate = ctx.live.gate
    const pick = resolvePick(gate, trimmed)
    if (pick !== undefined) {
      const shown = Array.isArray(pick) ? pick.join(', ') : pick
      return {
        kind: 'choice',
        projectId: ctx.live.projectId,
        runId: ctx.live.runId,
        gateId: gate.id,
        pick,
        reply: `Picked **${shown}**.`,
      }
    }
    // Not an answer: pass it through as a message rather than guessing at the gate.
  }

  if (ctx.live) {
    return {
      kind: 'message',
      projectId: ctx.live.projectId,
      runId: ctx.live.runId,
      text: trimmed,
      reply: 'Sent to the running session.',
    }
  }

  return { kind: 'start', projectId: ctx.target.id, text: trimmed, reply: `Starting a session in **${ctx.target.name}**.` }
}
