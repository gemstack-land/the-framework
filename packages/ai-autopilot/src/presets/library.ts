import { vikePageBuilder, nextPageBuilder, sharedPersonas } from '../personas/library.js'
import type { Persona } from '../personas/types.js'
import { definePreset } from './define.js'
import { detectFramework } from './detect.js'
import type { FrameworkDetection, FrameworkSignals, Preset } from './types.js'

/**
 * The flagship preset: Vike (Vite + SSR), renderer-agnostic. Its page builder
 * plus the shared neutral personas make up the Vike stack.
 */
export const vikePreset: Preset = definePreset({
  name: 'vike',
  framework: 'Vike',
  personas: [vikePageBuilder],
  signals: {
    dependencies: ['vike', 'vike-react', 'vike-vue', 'vike-solid'],
    files: [/(^|\/)\+Page(\.[\w-]+)?\.[jt]sx?$/, /(^|\/)\+config\.[jt]s$/],
  },
})

/** The second preset: Next.js (App Router + React Server Components). */
export const nextPreset: Preset = definePreset({
  name: 'next',
  framework: 'Next.js',
  personas: [nextPageBuilder],
  signals: {
    dependencies: ['next'],
    files: [/(^|\/)next\.config\.[cm]?[jt]s$/, /(^|\/)app\/.*\/page\.[jt]sx?$/, /(^|\/)app\/layout\.[jt]sx?$/],
  },
})

/** The built-in presets, in a stable order (flagship first). */
export function builtinPresets(): Preset[] {
  return [vikePreset, nextPreset]
}

/**
 * The full worker roster for a preset: its framework-specific personas followed
 * by the shared, framework-neutral ones (data layer + intent UI). This is what
 * you hand to `personaWorkers` / a planner roster, so only the page builder
 * changes between frameworks while the rest of the stack stays put.
 */
export function presetPersonas(preset: Preset, shared: readonly Persona[] = sharedPersonas): Persona[] {
  return [...preset.personas, ...shared]
}

/**
 * A set of {@link Preset}s with detection. Register the built-ins (or your own),
 * then {@link select} the preset for a project by its {@link FrameworkSignals}.
 * One shared core; the registry only decides which framework knowledge to layer.
 */
export class PresetRegistry {
  private readonly byName = new Map<string, Preset>()

  constructor(presets: readonly Preset[] = builtinPresets()) {
    for (const p of presets) this.byName.set(p.name, p)
  }

  /** The preset with this name, or `undefined`. */
  get(name: string): Preset | undefined {
    return this.byName.get(name)
  }

  /** All presets, in registration order. */
  all(): Preset[] {
    return [...this.byName.values()]
  }

  /** Add or replace a preset (e.g. a project's own framework). Returns `this`. */
  add(preset: Preset): this {
    this.byName.set(preset.name, preset)
    return this
  }

  /** Detect the framework for a project from its dependencies / files. */
  detect(signals: FrameworkSignals): FrameworkDetection {
    return detectFramework(this.all(), signals)
  }

  /**
   * Select the preset for a project: the detected one, or `fallback` (default the
   * flagship, first-registered preset) when nothing matched — so a run always has
   * a preset even on an empty or unrecognized project.
   */
  select(signals: FrameworkSignals, fallback?: Preset): { preset: Preset; detection: FrameworkDetection } {
    const detection = this.detect(signals)
    const preset = detection.preset ?? fallback ?? this.all()[0]
    if (!preset) throw new Error('[ai-autopilot] PresetRegistry.select: no presets registered')
    return { preset, detection }
  }
}

/** The built-in presets as a ready-to-use {@link PresetRegistry}. */
export function builtinPresetRegistry(): PresetRegistry {
  return new PresetRegistry(builtinPresets())
}
