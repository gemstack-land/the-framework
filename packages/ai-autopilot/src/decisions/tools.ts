import { z } from 'zod'
import { toolDefinition, type AnyTool } from '@gemstack/ai-sdk'
import type { DecisionLedger } from './ledger.js'
import type { DecisionStatus } from './types.js'

/** Options for {@link decisionTools}. */
export interface DecisionToolsOptions {
  /**
   * Prefix for every tool name (e.g. `decisions` → `decisions_consult`). Useful
   * when an agent already has a same-named tool. Default: no prefix.
   */
  prefix?: string
  /** Expose the `record_decision` tool. Default `true`. */
  record?: boolean
  /**
   * Called after a decision is recorded, so a caller can persist the ledger
   * (e.g. `() => saveLedger(fs, ledger)`). Awaited; a rejection surfaces as a
   * tool error. Omit to keep the ledger in memory only.
   */
  onRecord?: (ledger: DecisionLedger) => void | Promise<void>
}

/**
 * Expose a {@link DecisionLedger} to an agent as `ai-sdk` tools. This is how the
 * "consult before proposing, append on decide" policy reaches the model:
 *
 * - `consult_decisions` — before proposing an idea, check whether it was already
 *   decided; a rejected match means "do not re-pitch this".
 * - `record_decision` — after an idea is accepted or rejected, append it so the
 *   next session remembers.
 *
 * Pair with {@link decisionBriefing} to also front-load the rejected set into the
 * system prompt.
 */
export function decisionTools(ledger: DecisionLedger, opts: DecisionToolsOptions = {}): AnyTool[] {
  const name = (base: string) => (opts.prefix ? `${opts.prefix}_${base}` : base)
  const tools: AnyTool[] = []

  tools.push(
    toolDefinition({
      name: name('consult_decisions'),
      description:
        'Check whether an idea was already decided on this project before proposing it. ' +
        'Returns matching prior decisions; a rejected match means do not re-propose it.',
      inputSchema: z.object({
        idea: z.string().describe('The idea or change you are about to propose, in a short phrase.'),
      }),
    }).server(async ({ idea }) => {
      const matches = ledger.consult(idea)
      return {
        matches: matches.map(m => ({
          title: m.decision.title,
          status: m.decision.status,
          rationale: m.decision.rationale,
          score: Number(m.score.toFixed(2)),
        })),
      }
    }) as unknown as AnyTool,
  )

  if (opts.record !== false) {
    tools.push(
      toolDefinition({
        name: name('record_decision'),
        description:
          'Record a decision so it is not revisited: a rejected idea (with why) or an accepted choice.',
        inputSchema: z.object({
          title: z.string().describe('One-line statement of the idea or choice.'),
          status: z
            .enum(['rejected', 'accepted', 'superseded'])
            .describe('rejected = turned down; accepted = committed to.'),
          rationale: z.string().describe('Why it was rejected or chosen.'),
          tags: z.array(z.string()).optional().describe('Topic tags to match related ideas.'),
        }),
      })
        .server(async ({ title, status, rationale, tags }) => {
          const decision = ledger.record({
            title,
            status: status as DecisionStatus,
            rationale,
            ...(tags ? { tags } : {}),
          })
          await opts.onRecord?.(ledger)
          return { ok: true, id: decision.id }
        })
        .modelOutput(r => `recorded ${r.id}`) as unknown as AnyTool,
    )
  }

  return tools
}

/**
 * Render the rejected ideas as a system-prompt fragment to prepend to an agent's
 * instructions, so it starts a run already aware of what not to re-propose.
 * Returns `''` when nothing has been rejected, so it can be concatenated
 * unconditionally.
 */
export function decisionBriefing(ledger: DecisionLedger): string {
  const rejected = ledger.rejected()
  if (rejected.length === 0) return ''
  const lines = rejected.map(d => `- ${d.title} (rejected: ${d.rationale})`)
  return (
    'This project has already considered and rejected the following ideas. ' +
    'Do not propose them again unless the user explicitly reopens the question:\n' +
    lines.join('\n')
  )
}
