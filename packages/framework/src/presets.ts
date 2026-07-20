import { join } from 'node:path'
import { PRESETS, PRESET_DIR } from './preset-registry.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

// The registry moved to `preset-registry.ts` (#874) to keep it free of `node:*`, since a preset
// template can now read `tf.presets.<name>.filePath` and presets render in the browser (#520).
// Re-exported here so every existing import site keeps working.
export { PRESETS, PRESET_DIR, presetFilePath, presetContext } from './preset-registry.js'

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
