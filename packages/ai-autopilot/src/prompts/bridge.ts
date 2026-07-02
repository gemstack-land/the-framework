import type { Agent } from '@gemstack/ai-sdk'
import { decisionBriefing } from '../decisions/tools.js'
import type { DecisionLedger } from '../decisions/ledger.js'
import { definePrompt } from '../loop/define.js'
import type { LoopEvent, LoopPrompt } from '../loop/types.js'
import { PromptLibrary } from './library.js'
import type { Prompt } from './types.js'

/**
 * Compose a prompt's instructions for a run: the decisions briefing (the ideas
 * already rejected, from #112) first, then the prompt body. Returns just the body
 * when there is no ledger or nothing has been rejected.
 */
export function promptInstructions(prompt: Prompt, opts: { ledger?: DecisionLedger } = {}): string {
  const briefing = opts.ledger ? decisionBriefing(opts.ledger) : ''
  return briefing ? `${briefing}\n\n${prompt.instructions}` : prompt.instructions
}

/** Render a {@link LoopEvent} into the task text a prompt's worker is prompted with. */
export function renderTask(event: LoopEvent): string {
  const parts = [`Change kind: ${event.kind}`]
  if (event.summary) parts.push(`Summary: ${event.summary}`)
  if (event.paths?.length) parts.push(`Files touched:\n${event.paths.map(p => `- ${p}`).join('\n')}`)
  return parts.join('\n')
}

/** What {@link toLoopPrompt} hands your agent factory on each pass. */
export interface PromptAgentContext {
  prompt: Prompt
  event: LoopEvent
  /** 1-based pass number; a fresh agent is built per pass. */
  pass: number
  passes: number
  ledger?: DecisionLedger
  /** The composed instructions (briefing + body) — set these on the agent. */
  instructions: string
}

/** Builds the agent that runs one pass of a prompt. Called fresh each pass. */
export type MakePromptAgent = (ctx: PromptAgentContext) => Agent

/**
 * Bridge a {@link Prompt} into a {@link LoopPrompt} the loop can dispatch. The
 * loop calls this for each of the prompt's `passes`; `makeAgent` builds a fresh
 * agent every pass (that is the point — a reset context per pass), which is then
 * prompted with the event rendered by {@link renderTask}. The agent should carry
 * the file/browser tools the prompt needs (e.g. `runnerTools(session)`); the
 * prompt body and the decisions briefing arrive as `ctx.instructions`.
 */
export function toLoopPrompt(prompt: Prompt, makeAgent: MakePromptAgent): LoopPrompt {
  return definePrompt({
    id: prompt.id,
    passes: prompt.passes,
    run: async ctx => {
      const instructions = promptInstructions(prompt, ctx.ledger ? { ledger: ctx.ledger } : {})
      const agent = makeAgent({
        prompt,
        event: ctx.event,
        pass: ctx.pass,
        passes: ctx.passes,
        ...(ctx.ledger ? { ledger: ctx.ledger } : {}),
        instructions,
      })
      const response = await agent.prompt(renderTask(ctx.event))
      return response.text ?? ''
    },
  })
}

/**
 * Materialize a whole {@link PromptLibrary} (or list of prompts) into loop
 * prompts, ready to drop into `new Loop({ prompts })`. This is the turnkey wire:
 * the loop's `defaultLoopRules()` ids now resolve to real bodies.
 */
export function loopPromptsFor(
  prompts: PromptLibrary | readonly Prompt[],
  makeAgent: MakePromptAgent,
): LoopPrompt[] {
  const list = prompts instanceof PromptLibrary ? prompts.all() : [...prompts]
  return list.map(p => toLoopPrompt(p, makeAgent))
}
