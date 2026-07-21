import { join } from 'node:path'
import { PRESET_DIR, PRESET_STEMS } from './preset-registry.js'
import { presets } from './preset-catalog.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

// The registry moved to `preset-registry.ts` (#874) to keep it free of `node:*`, since a preset
// template can now read `tf.presets.<name>.filePath` and presets render in the browser (#520).
// Re-exported here so every existing import site keeps working.
export { PRESET_DIR, PRESET_STEMS, presetFilePath, presetContext } from './preset-registry.js'

/**
 * The materialized presets by file stem, derived from the catalog — the registry names the
 * stems, the catalog owns the templates, and this join is the only place the two meet. It
 * used to be a second hand-maintained table re-binding the same generated constants, so a
 * seventh quality preset was two edits with nothing checking they agreed; now a stem with no
 * catalog row simply vanishes from this map, which `presets.test.ts`'s exact key-set
 * assertion turns into a failure.
 */
export const PRESETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(presets)
    .map(def => [def.name.replace(/-/g, '_'), def.template] as const)
    .filter(([stem]) => (PRESET_STEMS as readonly string[]).includes(stem)),
)

/**
 * Materialize every preset into `<cwd>/.the-framework/presets/<name>.md` so an on-before-mergeable
 * TODO entry's `filePath` resolves to a real file the agent can open (#326). The files keep
 * the `${{ tf.params.what }}` blank unrendered: the entry tells the agent what to set it to.
 * The package ships the presets compiled (`files: ["dist"]`), so they land on disk only once
 * written here. Overwrites, so a re-install refreshes them to the installed framework version.
 */
export async function materializePresets(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<void> {
  await fs.mkdir(join(cwd, PRESET_DIR))
  for (const [name, text] of Object.entries(PRESETS)) {
    await fs.write(join(cwd, PRESET_DIR, `${name}.md`), text)
  }
}
