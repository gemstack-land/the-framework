/**
 * The `${{ ... }}` markdown-fragment layer (#350): the #326 system prompt embeds
 * JS expressions (e.g. a ternary on `tf.params.autopilot`), so the verbatim
 * template renders against a context at run time. Each fragment is a real JS
 * expression evaluated with `new Function` — that is arbitrary code execution,
 * so only ever render trusted templates (the built-in system prompt), never
 * user- or repo-supplied text.
 */

const FRAGMENT = /\$\{\{([\s\S]*?)\}\}/g

/** Thrown when a `${{ ... }}` fragment fails to evaluate or evaluates to `undefined`. */
export class TemplateFragmentError extends Error {
  /** The fragment's expression, as written in the template. */
  readonly fragment: string
  constructor(fragment: string, detail: string) {
    super(`[framework] template fragment \${{${fragment}}} ${detail}`)
    this.name = 'TemplateFragmentError'
    this.fragment = fragment
  }
}

/**
 * Render a template by evaluating every `${{ <expression> }}` fragment against
 * `context` (each key becomes a variable the expression can read, e.g. `tf`).
 * The result is stringified in place; text outside fragments passes through
 * byte-identical. A fragment that throws or evaluates to `undefined` (almost
 * always a typo) throws a {@link TemplateFragmentError} rather than silently
 * degrading the prompt.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  const names = Object.keys(context)
  const values = names.map(name => context[name])
  return template.replace(FRAGMENT, (_, expression: string) => {
    let result: unknown
    try {
      result = new Function(...names, `'use strict'; return (${expression});`)(...values)
    } catch (err) {
      throw new TemplateFragmentError(expression, `failed to evaluate: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (result === undefined) throw new TemplateFragmentError(expression, 'evaluated to undefined (typo in the expression?)')
    return String(result)
  })
}
