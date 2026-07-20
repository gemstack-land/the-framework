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

/** A quality preset's public shape: its run-kind name, the `what` param, its template, and a renderer. */
export interface PresetDef {
  name: string
  params: readonly [PresetParam]
  template: string
  /** Render the template, filling `${{ tf.params.what }}`; a blank/omitted `what` falls back to the default. */
  render: (what?: string, ctx?: PresetRenderContext) => string
}

/**
 * Define a quality preset (#326/#330) from the three things that actually differ between them:
 * the run-kind name, the prompt template, and what the one `what` param means. Every preset
 * has the identical shape — a single `what` param rendered into the `${{ tf.params.what }}`
 * blank — so that shape lives here once instead of in each preset file. A blank/omitted `what`
 * falls back to the default, so a dashboard button runs with zero input; a passed value is
 * trimmed first.
 *
 * The default is itself rendered (#874). `${{ }}` has always been JS-evaluated, but the default
 * was the one string that never went through the evaluator, so a `${{ }}` inside it reached the
 * prompt as literal text. Rendering it against the same context is what lets the default depend
 * on the session the preset was launched from.
 */
export function definePreset(name: string, template: string, whatDescription: string): PresetDef {
  const params = [{ name: 'what', default: DEFAULT_WHAT, description: whatDescription }] as const
  return {
    name,
    params,
    template,
    render: (what, ctx = {}) => {
      const tf = {
        session_name: ctx.session_name,
        settings: ctx.settings ?? {},
        presets: ctx.presets ?? presetContext(),
      }
      // The default renders with an empty `params`: it can read the session, but not itself.
      const target = what?.trim() || renderTemplate(params[0].default, { tf: { ...tf, params: {} } })
      return renderTemplate(template, { tf: { ...tf, params: { what: target } } })
    },
  }
}
