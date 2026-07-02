/**
 * The loop — the event-to-prompt-chain policy of `@gemstack/ai-autopilot`.
 *
 * The agent declares a {@link LoopEvent} (a semantic change kind); a
 * {@link LoopRule} maps that kind to an ordered chain of {@link LoopPrompt}s;
 * the {@link Loop} runs them (N fresh-context passes each) and consults the
 * decisions ledger. {@link defaultLoopRules} is the built-in web-app policy.
 */
export { definePrompt, defineRule, LoopError } from './define.js'
export { Loop, createLoop, type LoopOptions } from './loop.js'
export { defaultLoopRules, LOOP_EVENTS, LOOP_PROMPTS } from './policy.js'
export type {
  LoopEvent,
  LoopContext,
  LoopPrompt,
  LoopPromptSpec,
  LoopRule,
  LoopRuleSpec,
  PassResult,
  PromptOutcome,
  LoopRunResult,
  LoopProgress,
} from './types.js'
