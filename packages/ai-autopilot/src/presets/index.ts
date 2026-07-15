/**
 * The web-app preset seam (#115) — *detect* the app's framework, on top of the
 * agnostic core. Vike is the flagship; Next.js is the second. A new framework is
 * a new {@link Preset}, not a runtime fork.
 *
 * - {@link definePreset} — define a framework preset
 * - {@link vikePreset} / {@link nextPreset} — the built-ins
 * - {@link detectFramework} — score a project's deps/files against presets
 * - {@link PresetRegistry} — register presets and {@link PresetRegistry.select} one
 */
export { definePreset, PresetError } from './define.js'
export { detectFramework } from './detect.js'
export { vikePreset, nextPreset, builtinPresets, PresetRegistry, builtinPresetRegistry } from './library.js'
export type {
  Preset,
  PresetSpec,
  PresetSignals,
  FrameworkSignals,
  PresetScore,
  FrameworkDetection,
} from './types.js'
