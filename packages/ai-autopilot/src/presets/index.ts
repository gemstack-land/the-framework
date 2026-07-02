/**
 * The web-app preset seam (#115) — framework-specific knowledge (personas) picked
 * by *detecting* the app's framework, on top of the agnostic core. Vike is the
 * flagship; Next.js is the second. A new framework is a new {@link Preset}, not a
 * runtime fork.
 *
 * - {@link definePreset} — define a framework preset
 * - {@link vikePreset} / {@link nextPreset} — the built-ins
 * - {@link detectFramework} — score a project's deps/files against presets
 * - {@link PresetRegistry} — register presets and {@link PresetRegistry.select} one
 * - {@link presetPersonas} — a preset's personas + the shared neutral ones
 */
export { definePreset, PresetError } from './define.js'
export { detectFramework } from './detect.js'
export {
  vikePreset,
  nextPreset,
  builtinPresets,
  presetPersonas,
  PresetRegistry,
  builtinPresetRegistry,
} from './library.js'
export type {
  Preset,
  PresetSpec,
  PresetSignals,
  FrameworkSignals,
  PresetScore,
  FrameworkDetection,
} from './types.js'
