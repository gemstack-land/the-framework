import { definePreset } from './preset-prompt.js'
import { PRESETS_SECURITY_AUDIT } from './prompts.generated.js'

/**
 * The [Security audit] preset (#461): Rom's exhaustive security pass, shipped as
 * a direct prompt like [Readability] (#360) and [Maintainability] (#361) — it
 * scrutinizes existing code, so it skips the scope -> build scaffolding. `${{ tf.params.what }}` is the user-facing blank (defaults to the launching session, else the whole codebase).
 * It is also one of the on-before-mergeable quality prompts #326 fires on
 * `setReadyForMerge()`. Keep it in sync with the issue rather than growing it here.
 */
const securityAudit = definePreset('security-audit', PRESETS_SECURITY_AUDIT, 'What to security-audit')

/** The preset's name, as the dashboard button uses it. */
export const SECURITY_AUDIT_PRESET_NAME = securityAudit.name
/** The one user param: what to audit. Defaults to the launching session, else the whole codebase (#874). */
export const SECURITY_AUDIT_PARAMS = securityAudit.params
/** The prompt template, verbatim from #461 (with `${{ tf.params.what }}` as the blank). */
export const SECURITY_AUDIT_PROMPT_TEMPLATE = securityAudit.template
/** Render the Security audit prompt, filling its `${{ tf.params.what }}` blank (defaults to the launching session, else the whole codebase). */
export const renderSecurityAuditPrompt = securityAudit.render
