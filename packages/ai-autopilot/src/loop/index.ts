/**
 * The loop — the event-to-prompt-chain policy of `@gemstack/ai-autopilot`.
 *
 * The agent declares a {@link LoopEvent} (a semantic change kind); a
 * {@link Loop} maps that kind to an ordered chain of {@link LoopPrompt}s;
 * the {@link LoopEngine} runs them (N fresh-context passes each) and consults the
 * decisions ledger. {@link defaultLoops} is the built-in web-app policy.
 */
export { definePrompt, defineLoop, LoopError } from './define.js'
export { LoopEngine, createLoopEngine, type LoopEngineOptions } from './loop.js'
export { defaultLoops, LOOP_EVENTS, LOOP_PROMPTS } from './policy.js'
export { parseVerdict, isPassing, type Verdict } from './verdict.js'
export type {
  LoopEvent,
  LoopContext,
  LoopPrompt,
  LoopPromptSpec,
  Loop,
  LoopSpec,
  PassResult,
  PromptOutcome,
  LoopRunResult,
  LoopProgress,
} from './types.js'
