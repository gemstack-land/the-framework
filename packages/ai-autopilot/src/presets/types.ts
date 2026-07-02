import type { Persona } from '../personas/types.js'

/**
 * The web-app preset seam (#115). The engine (loop + state layer) is
 * framework-agnostic; the framework-specific knowledge lives here, at the
 * persona layer, and is selected by *detecting* the app's framework rather than
 * forking the runtime. Vike is the flagship preset; Next.js is the second. New
 * frameworks are a new {@link Preset}, not a change to the core.
 *
 * A preset is data: a name, its framework-specific personas, and the signals that
 * identify it in a project. {@link detectFramework} scores the signals; the
 * shared, framework-neutral personas (data layer, intent UI) are added on top by
 * {@link presetPersonas}, so a preset only carries what is genuinely per-framework.
 */

/** How to recognize a framework in a project. */
export interface PresetSignals {
  /** Dependency names whose presence indicates this framework (e.g. `vike`, `next`). */
  dependencies?: readonly string[]
  /** File-path patterns that indicate it (e.g. `next.config.*`, a `+Page` file). */
  files?: readonly RegExp[]
}

/** A framework preset: framework-specific personas + the signals that detect it. */
export interface Preset {
  /** Stable id, kebab-case (e.g. `vike`, `next`). */
  readonly name: string
  /** Human framework name (e.g. `Vike`, `Next.js`). */
  readonly framework: string
  /** The framework-specific personas (the neutral shared ones are added separately). */
  readonly personas: readonly Persona[]
  /** How this preset is detected in a project. */
  readonly signals: PresetSignals
}

/** The author-facing shape for {@link definePreset}; personas/signals default to empty. */
export interface PresetSpec {
  name: string
  framework: string
  personas?: readonly Persona[]
  signals?: PresetSignals
}

/** What {@link detectFramework} inspects: a project's dependencies and/or file list. */
export interface FrameworkSignals {
  /** Dependencies, as a `name -> version` map or a bare list of names. */
  dependencies?: Record<string, string> | readonly string[]
  /** Paths present in the project (any depth). */
  files?: readonly string[]
}

/** One preset's score against the project signals. */
export interface PresetScore {
  preset: string
  score: number
  /** The concrete signals that matched. */
  reasons: string[]
}

/** The outcome of detection: the best preset (if any) and every score. */
export interface FrameworkDetection {
  /** The highest-scoring preset, when one matched at all. */
  preset?: Preset
  /** Its framework name, for narration. */
  framework?: string
  /** The winning score (0 when nothing matched). */
  confidence: number
  /** Every preset's score, highest first — for tie inspection / debugging. */
  scores: PresetScore[]
}
