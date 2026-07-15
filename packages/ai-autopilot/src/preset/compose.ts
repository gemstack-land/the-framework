import { defineDomainPreset } from './define.js'
import type { DomainPreset, DomainPresetMeta } from './types.js'
import type { Prompt } from '../prompts/types.js'

/**
 * Compose several {@link DomainPreset}s into one under a new label — this is what
 * makes presets-of-presets fall out: a parent preset is just the composition of
 * the children it selects.
 *
 * Merge rules:
 * - **loops** concatenate in preset order (the loop engine already de-dupes the
 *   prompt ids a chain resolves to, so overlapping loops are harmless).
 * - **prompts** merge by `id`, later presets winning, so a preset later in the
 *   list overrides a shared body. They come out sorted by id for a stable result.
 */
export function composeDomainPresets(meta: DomainPresetMeta, ...presets: DomainPreset[]): DomainPreset {
  const prompts = new Map<string, Prompt>()
  const loops = presets.flatMap(p => [...p.loops])
  // Carry the default build event kind; a later preset that declares one wins.
  const defaultEvent = presets.reduce<string | undefined>((acc, p) => p.defaultEvent ?? acc, undefined)

  for (const preset of presets) {
    for (const prompt of preset.prompts) prompts.set(prompt.id, prompt)
  }

  return defineDomainPreset({
    ...meta,
    ...(defaultEvent ? { defaultEvent } : {}),
    loops,
    prompts: [...prompts.values()].sort((a, b) => a.id.localeCompare(b.id)),
  })
}

/** Pick the preset with `name` from a set (e.g. the user's chosen domain), or `undefined`. */
export function selectPreset(presets: readonly DomainPreset[], name: string): DomainPreset | undefined {
  return presets.find(p => p.name === name)
}
