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

/** How one preset is declared. Everything that differs between presets, and nothing else. */
export interface PresetSpec {
  /** The run-kind name, as the CLI subcommand and the run record use it. */
  name: string
  /** The prompt template, from `prompts/presets/<stem>.md`. */
  template: string
  /** What the one `what` param means. Omit for a preset that scopes itself. */
  what?: string
  /**
   * The launcher button's label. Lives here rather than in the dashboard: it is the preset's
   * user-facing name, and keeping it in the other package meant a preset's name and its label
   * could only be kept in step by hand.
   */
  label: string
  /** One line under the label, when the name alone does not say what the preset queues. */
  tooltip?: string
}

/** A preset's public shape: how it is declared, plus its resolved params and a renderer. */
export interface PresetDef extends PresetSpec {
  /** The one `what` param, or empty for a preset that scopes itself. */
  params: readonly PresetParam[]
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
export function definePreset(spec: PresetSpec): PresetDef {
  const { template, what } = spec
  // Paramless: nothing to fill, so the template is the prompt.
  if (what === undefined) return { ...spec, params: [], render: () => template }
  return {
    ...spec,
    params: [{ name: 'what', default: DEFAULT_WHAT, description: what }],
    render: (value, ctx = {}) => {
      // The default renders with an empty `params`: it can read the session, but not itself.
      const target = value?.trim() || defaultWhat(ctx)
      return renderTemplate(template, { tf: { ...tfFrom(ctx), params: { what: target } } })
    },
  }
}
