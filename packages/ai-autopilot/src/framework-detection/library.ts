import { defineFrameworkPreset } from './define.js'
import { detectFramework } from './detect.js'
import type { FrameworkDetection, FrameworkSignals, FrameworkPreset } from './types.js'

/** The flagship preset: Vike (Vite + SSR), renderer-agnostic. */
export const vikePreset: FrameworkPreset = defineFrameworkPreset({
  name: 'vike',
  framework: 'Vike',
  signals: {
    dependencies: ['vike', 'vike-react', 'vike-vue', 'vike-solid'],
    files: [/(^|\/)\+Page(\.[\w-]+)?\.[jt]sx?$/, /(^|\/)\+config\.[jt]s$/],
  },
})

/** The second preset: Next.js (App Router + React Server Components). */
export const nextPreset: FrameworkPreset = defineFrameworkPreset({
  name: 'next',
  framework: 'Next.js',
  signals: {
    dependencies: ['next'],
    files: [/(^|\/)next\.config\.[cm]?[jt]s$/, /(^|\/)app\/.*\/page\.[jt]sx?$/, /(^|\/)app\/layout\.[jt]sx?$/],
  },
})

/** The built-in presets, in a stable order (flagship first). */
export function builtinFrameworkPresets(): FrameworkPreset[] {
  return [vikePreset, nextPreset]
}

/**
 * A set of {@link FrameworkPreset}s with detection. Register the built-ins (or
 * your own), then {@link select} the preset for a project by its
 * {@link FrameworkSignals}.
 */
export class FrameworkPresetRegistry {
  private readonly byName = new Map<string, FrameworkPreset>()

  constructor(presets: readonly FrameworkPreset[] = builtinFrameworkPresets()) {
    for (const p of presets) this.byName.set(p.name, p)
  }

  /** The preset with this name, or `undefined`. */
  get(name: string): FrameworkPreset | undefined {
    return this.byName.get(name)
  }

  /** All presets, in registration order. */
  all(): FrameworkPreset[] {
    return [...this.byName.values()]
  }

  /** Add or replace a preset (e.g. a project's own framework). Returns `this`. */
  add(preset: FrameworkPreset): this {
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
  select(signals: FrameworkSignals, fallback?: FrameworkPreset): { preset: FrameworkPreset; detection: FrameworkDetection } {
    const detection = this.detect(signals)
    const preset = detection.preset ?? fallback ?? this.all()[0]
    if (!preset) throw new Error('[ai-autopilot] FrameworkPresetRegistry.select: no presets registered')
    return { preset, detection }
  }
}

/** The built-in presets as a ready-to-use {@link FrameworkPresetRegistry}. */
export function builtinFrameworkPresetRegistry(): FrameworkPresetRegistry {
  return new FrameworkPresetRegistry(builtinFrameworkPresets())
}
