/**
 * The Open Loop bundle unit (#204, #242): a **domain preset** = {loops, prompts}.
 * Author one in code with {@link defineDomainPreset}, load one from a directory
 * of `.md` files with {@link loadDomainPreset}, and merge several into one with
 * {@link composeDomainPresets} (so presets-of-presets falls out).
 *
 * Distinct from the framework `Preset` in `presets/` (a project detector); this
 * is the user-picked domain bundle.
 */
export { defineDomainPreset, DomainPresetError } from './define.js'
export { composeDomainPresets, selectPreset } from './compose.js'
export {
  loadDomainPreset,
  loadDomainPresetsFrom,
  builtinDomainPresets,
  loadLoopsFrom,
  builtinPresetsDir,
  softwareDevelopmentPreset,
  type LoadPresetOptions,
} from './load.js'
export { selectWinners, stemOf, readConditions, type Conditional } from './conditions.js'
export type { DomainPreset, DomainPresetSpec, DomainPresetMeta } from './types.js'
