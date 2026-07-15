import { renderPresetPrompt, type PresetParam } from './preset-params.js'
import { PRESETS_SECURITY_AUDIT } from './prompts.generated.js'

/**
 * The [Security audit] preset (#461): Rom's exhaustive security pass, shipped as
 * a direct prompt like [Readability] (#360) and [Maintainability] (#361) — it
 * scrutinizes existing code, so it skips the scope -> build scaffolding. `<PARAM:what>` is the user-facing blank (defaults to `this PR`).
 * It is also one of the post-merge quality prompts #326 fires on
 * `setReadyForMerge()`. Keep it in sync with the issue rather than growing it here.
 */

/** The preset's name, as the dashboard button uses it. */
export const SECURITY_AUDIT_PRESET_NAME = 'security-audit'

/** The one user param: what to audit. Defaults to `this PR`, like the others. */
export const SECURITY_AUDIT_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to security-audit' },
]

/** The prompt template, verbatim from #461 (with `<PARAM:what>` as the blank). */
export const SECURITY_AUDIT_PROMPT_TEMPLATE = PRESETS_SECURITY_AUDIT

/**
 * Render the Security audit prompt for a target. A blank / omitted `what` falls
 * back to the declared default (`this PR`), so the dashboard button runs with
 * zero input.
 */
export function renderSecurityAuditPrompt(what?: string): string {
  return renderPresetPrompt(SECURITY_AUDIT_PROMPT_TEMPLATE, {
    params: SECURITY_AUDIT_PARAMS,
    values: { what },
  })
}
