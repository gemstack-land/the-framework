/**
 * Preset params (#330): the substitution primitive behind preset prompts. A preset
 * prompt is a markdown template that carries `<PARAM:name>` placeholders — e.g. the
 * [Research] preset (#331) opens with:
 *
 *   Measure "problem variability" of `<PARAM:what>`.
 *
 * `<PARAM:what>` is replaced with the value of the param named `what`. A param can
 * declare a default (here, `this PR`), so a preset button runs with zero input yet
 * still lets the user override it. A placeholder with neither a supplied value nor a
 * default is *unfilled* — the caller either asks the user to fill the blank (the
 * issue's alternative) or renders with a default.
 *
 * This is only the `<PARAM:name>` layer. The framework's own tokens (`SESSION_NAME`,
 * `AWAIT`, `REVIEW_FILE`, `SHOW_IT`) in #326/#331 are a separate expansion resolved
 * elsewhere, not user params.
 */

/** Matches a `<PARAM:name>` placeholder; the name is a letter-led slug. */
export const PARAM_PATTERN = /<PARAM:([A-Za-z][A-Za-z0-9_-]*)>/g

/** One declared param of a preset prompt: its name, optional default, optional label. */
export interface PresetParam {
  /** The name referenced as `<PARAM:name>` in the template. */
  name: string
  /** Value substituted when the caller supplies none. Absent = the caller must fill it. */
  default?: string
  /** Human label shown when prompting the user to fill this blank. */
  description?: string
}

/** Inputs shared by the render/inspect helpers. */
export interface PresetParamOptions {
  /** Declared params (defaults + labels), keyed by {@link PresetParam.name}. */
  params?: readonly PresetParam[]
  /** Caller-supplied values, keyed by param name. A non-blank value overrides the default. */
  values?: Record<string, string | undefined>
}

/**
 * Thrown by {@link renderPresetPrompt} when the template references params that have
 * neither a supplied value nor a default. {@link missing} lists their names so the
 * caller can prompt for exactly those blanks.
 */
export class PresetParamError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`preset prompt has unfilled params: ${missing.join(', ')}`)
    this.name = 'PresetParamError'
  }
}

/** The distinct param names a template references, in first-seen order. */
export function extractParamNames(template: string): string[] {
  const seen = new Set<string>()
  for (const m of template.matchAll(PARAM_PATTERN)) seen.add(m[1]!)
  return [...seen]
}

/**
 * Resolve one param's value: a non-blank supplied value wins, else the declared
 * default. A blank supplied value (empty/whitespace) is treated as unset, so a
 * cleared fill-in-the-blank field falls back to the default rather than erasing it.
 * Returns `undefined` when the param is unfilled.
 */
function resolveValue(name: string, opts: PresetParamOptions): string | undefined {
  const supplied = opts.values?.[name]
  if (typeof supplied === 'string' && supplied.trim() !== '') return supplied
  return opts.params?.find(p => p.name === name)?.default
}

/**
 * The params a template references that are still unfilled (no value, no default),
 * as their {@link PresetParam} descriptors (name + label). This is what a
 * "fill in the blanks" UI asks the user before rendering.
 */
export function unfilledParams(template: string, opts: PresetParamOptions = {}): PresetParam[] {
  return extractParamNames(template)
    .filter(name => resolveValue(name, opts) === undefined)
    .map(name => opts.params?.find(p => p.name === name) ?? { name })
}

/**
 * Substitute every `<PARAM:name>` in the template from the supplied values, falling
 * back to declared defaults. Throws {@link PresetParamError} listing the names that
 * are unfilled, so a preset never runs with a raw placeholder left in the prompt.
 */
export function renderPresetPrompt(template: string, opts: PresetParamOptions = {}): string {
  const missing = unfilledParams(template, opts).map(p => p.name)
  if (missing.length) throw new PresetParamError(missing)
  return template.replace(PARAM_PATTERN, (_, name: string) => resolveValue(name, opts)!)
}
