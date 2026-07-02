import { defineRule } from './define.js'
import type { LoopRule } from './types.js'

/**
 * Canonical event kinds the built-in policy triggers on. The agent declares one
 * of these on a {@link LoopEvent} after doing work.
 */
export const LOOP_EVENTS = {
  /** A substantial code change: fires review + code-quality + security. */
  majorChange: 'major-change',
  /** A new user-facing flow (auth, checkout, ...): fires QA + UX. */
  uiFlow: 'ui-flow',
} as const

/**
 * Canonical prompt ids the built-in policy references. The prompts library
 * (#111) registers its bundles under these ids so the default rules resolve;
 * the loop itself is prompt-source-agnostic and only knows the ids.
 */
export const LOOP_PROMPTS = {
  review: 'review',
  codeQuality: 'code-quality',
  security: 'security',
  qa: 'qa',
  ux: 'ux',
} as const

/**
 * The built-in loop policy as data: a major change runs review then code-quality
 * then security; a new UI flow runs QA then UX. Extend it by concatenating your
 * own {@link defineRule} results, or replace it wholesale.
 */
export function defaultLoopRules(): LoopRule[] {
  return [
    defineRule({
      on: LOOP_EVENTS.majorChange,
      run: [LOOP_PROMPTS.review, LOOP_PROMPTS.codeQuality, LOOP_PROMPTS.security],
    }),
    defineRule({
      on: LOOP_EVENTS.uiFlow,
      run: [LOOP_PROMPTS.qa, LOOP_PROMPTS.ux],
    }),
  ]
}
