/**
 * The framework-detection seam (#115) — *detect* the app's framework, on top of
 * the agnostic core. Vike is the flagship; Next.js is the second. A new framework is
 * a new {@link FrameworkPreset}, not a runtime fork.
 *
 * - {@link defineFrameworkPreset} — define a framework preset
 * - {@link vikePreset} / {@link nextPreset} — the built-ins
 * - {@link detectFramework} — score a project's deps/files against presets
 * - {@link FrameworkPresetRegistry} — register presets and {@link FrameworkPresetRegistry.select} one
 */
export { defineFrameworkPreset, FrameworkPresetError } from './define.js'
export { detectFramework } from './detect.js'
export { vikePreset, nextPreset, builtinFrameworkPresets, FrameworkPresetRegistry, builtinFrameworkPresetRegistry } from './library.js'
export type {
  FrameworkPreset,
  FrameworkPresetSpec,
  FrameworkPresetSignals,
  FrameworkSignals,
  FrameworkPresetScore,
  FrameworkDetection,
} from './types.js'
