import { renderTemplate } from './prompt-template.js'
import { presetContext } from './preset-registry.js'
import type { TfContext } from './system-prompt.js'

/**
 * The default target a preset runs against (#874): the session it was launched from, falling back
 * to the whole codebase when there is no session yet. A template, not a plain string — see
 * {@link definePreset} for why that distinction matters.
 */
export const DEFAULT_WHAT = '${{ tf.session_name || "entire codebase" }}'

/** A quality preset's single user param: the target to run against. */
export interface PresetParam {
  name: 'what'
  /** A `${{ }}` template, rendered against the same context as the preset body. */
  default: string
  description: string
}

/**
 * What a preset can read beyond its own params. Everything is optional: a preset rendered before
 * any session exists (the launcher's prompt preview) simply has no `session_name`, which is what
 * makes {@link DEFAULT_WHAT}'s `||` fall through to the codebase-wide default.
 */
export interface PresetRenderContext {
  /** The launching session's name, once one has been set. */
  session_name?: string | undefined
  /** Framework settings, e.g. `technical_control`. Defaults to `{}` so a template never throws. */
  settings?: TfContext['settings']
  /** stem -> `{ filePath }`, so a preset can point at another preset. Defaults to the registry. */
  presets?: Record<string, { filePath: string }> | undefined
}

/** The `tf` a preset renders against. `settings`/`presets` default so a template never throws. */
function tfFrom(ctx: PresetRenderContext): Record<string, unknown> {
  return {
    session_name: ctx.session_name,
    settings: ctx.settings ?? {},
    presets: ctx.presets ?? presetContext(),
  }
}

/**
 * {@link DEFAULT_WHAT}, rendered. Exported so a caller that *labels* a run (the CLI's log title)
 * says the same thing the prompt targets, instead of keeping its own copy of the default.
 */
export function defaultWhat(ctx: PresetRenderContext = {}): string {
  return renderTemplate(DEFAULT_WHAT, { tf: { ...tfFrom(ctx), params: {} } })
}

/** A preset's public shape: its run-kind name, its params, its template, and a renderer. */
export interface PresetDef {
  name: string
  /** The one `what` param, or empty for a preset that scopes itself. */
  params: readonly PresetParam[]
  template: string
  /** Render the template, filling `${{ tf.params.what }}`; a blank/omitted `what` falls back to the default. */
  render: (what?: string, ctx?: PresetRenderContext) => string
}

/**
 * Define a preset (#326/#330) from the three things that actually differ between them: the
 * run-kind name, the prompt template, and what the one `what` param means. Every preset has the
 * identical shape, so that shape lives here once instead of in each preset file.
 *
 * Omitting `whatDescription` defines a **paramless** preset: the prompt scopes itself (the triage
 * and PM presets read the repo's own tickets or plans), so there is no blank to fill and the
 * template renders verbatim. That case used to have a second near-identical factory, and six
 * further presets hand-rolled it using neither — one optional argument covers all three.
 *
 * A blank/omitted `what` falls back to the default, so a dashboard button runs with zero input; a
 * passed value is trimmed first. The default is itself rendered (#874): `${{ }}` has always been
 * JS-evaluated, but the default was the one string that never went through the evaluator, so a
 * `${{ }}` inside it reached the prompt as literal text. Rendering it against the same context is
 * what lets the default depend on the session the preset was launched from.
 */
export function definePreset(name: string, template: string, whatDescription?: string): PresetDef {
  // Paramless: nothing to fill, so the template is the prompt.
  if (whatDescription === undefined) return { name, template, params: [], render: () => template }
  const params: readonly PresetParam[] = [{ name: 'what', default: DEFAULT_WHAT, description: whatDescription }]
  return {
    name,
    params,
    template,
    render: (what, ctx = {}) => {
      // The default renders with an empty `params`: it can read the session, but not itself.
      const target = what?.trim() || defaultWhat(ctx)
      return renderTemplate(template, { tf: { ...tfFrom(ctx), params: { what: target } } })
    },
  }
}
