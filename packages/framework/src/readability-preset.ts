import { renderPresetPrompt, type PresetParam } from './preset-params.js'

/**
 * The [Readability] preset (#360): Rom's refactor-for-human-readers pass, shipped
 * as a direct prompt like [Research] (#331) — it reworks existing code, so it
 * skips the scope -> architect -> build scaffolding. `<PARAM:what>` is the
 * user-facing blank (#330); `<FUNCTION>` is an agent-facing macro defined at the
 * bottom of the prompt itself, like the Research preset's CAPS tokens.
 */

/** The preset's name, as the dashboard button uses it. */
export const READABILITY_PRESET_NAME = 'readability'

/** The one user param: what to refactor. Defaults to `this PR`, like Research. */
export const READABILITY_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to refactor for readability' },
]

/** The prompt template, verbatim from #360 (with `<PARAM:what>` as the blank). */
export const READABILITY_PROMPT_TEMPLATE = `Refactor <PARAM:what> to make it as easy as possible for humans to read:
- Pinnacle architectural split
  - Does each file and each <FUNCTION> represent a sensible and natural abstraction?
  - Rate the *seams*, not just the boxes: for each call site, ask whether the responsibility sits on the right side of the boundary — should a caller's wrapper move down into the callee (or vice versa)? A <FUNCTION> can be clean, DRY and well-tested in isolation yet still be in the wrong place. "Well-factored" is not "well-located".
- Linearity (for humans)
  - Put yourself in the shoes of a human reader who reads everything in a linear fashion
  - Top to bottom: place callers above callees so readers encounter high-level logic before implementation details (humans think high-level first)
  - Altitude pass: for each entry-point / orchestration <FUNCTION>, read it top-to-bottom as prose. Flag any line that drops the reader into lower-level mechanism (a flag, a thunk, a log verb, error plumbing) in the middle of what should be a high-level narrative. For each, ask: can that mechanism move down into the callee so the caller reads at one consistent altitude? Prioritize the reading path of all the <FUNCTION> a reader hits first.
- Before starting to work: list *ALL* files and *ALL* <FUNCTION> in this chat, rate them all (0: convoluted abstraction, hard to read, wrong place — 10: perfect), and give a reason for your rating
  - DON'T skip any file nor any <FUNCTION> in your rating list — write an extra separated list in this chat of all files and all <FUNCTION> and put a ✅ tick to each entry to double check whether you forgot to rate something. So two lists: one list of ratings & explanation, and a second confirmation list.
- Separate commit for each refactor
- Work until it's exceptionally good. We as an expert team will check against every little detail.
  - If we see that you gave mostly a 10/10 rating, that's a sign you've been lazy... so make sure you scrutinize everything and spend a substantial amount of time. We don't want to prompt you again and again to achieve quality — autonomously strive for quality on your own without us pushing you.
- Give summary of what you worked on: print the lists again with old rating => new rating with link to commit(s)

FUNCTION: an actual function or a class, procedure, etc. (anything that represents a unit of logic)`

/**
 * Render the Readability prompt for a target. A blank / omitted `what` falls
 * back to the declared default (`this PR`), so the dashboard button runs with
 * zero input.
 */
export function renderReadabilityPrompt(what?: string): string {
  return renderPresetPrompt(READABILITY_PROMPT_TEMPLATE, {
    params: READABILITY_PARAMS,
    values: { what },
  })
}
