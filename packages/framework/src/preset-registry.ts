import { THE_FRAMEWORK_DIR } from './framework-dir.js'

/**
 * Where the quality presets land on disk (#326), split out of `presets.ts` (#874) so it stays
 * free of `node:*` — a preset's own template can reference `tf.presets.<name>.filePath`, and
 * presets render in the browser (#520).
 *
 * Membership is *stems only*: the templates live in the catalog (`preset-catalog.ts`), which
 * is the one table of presets. This module cannot hold them without forking that table — it
 * sits below `preset-prompt.ts` (which reads {@link presetContext}), and the catalog sits
 * above it, so importing the catalog from here would cycle. `presets.ts` joins the two on the
 * node side, and its `PRESETS` export derives from the catalog rather than re-binding the
 * generated constants a second time.
 */

/**
 * The file stems of the presets that materialize to disk. The stem is both the on-disk name
 * and the `tf.presets.<stem>` key the prompts read: `tf.presets.security_audit.filePath` uses
 * the underscore file stem, not the hyphenated run-kind name (`security-audit`).
 */
export const PRESET_STEMS = ['maintainability', 'readability', 'security_audit', 'research', 'ux', 'maintenance'] as const

/** Where the materialized presets live under a repo's `.the-framework/` (#326). */
export const PRESET_DIR = `${THE_FRAMEWORK_DIR}/presets`

/**
 * The workspace-relative path a materialized preset lives at, e.g.
 * `.the-framework/presets/maintainability.md`. A TODO entry carries this as
 * `tf.presets.<name>.filePath`, and the agent opens it. Workspace-relative, because that
 * is the agent's cwd.
 */
export function presetFilePath(name: string): string {
  return `${PRESET_DIR}/${name}.md`
}

/** The `tf.presets` map the prompts read: stem -> `{ filePath }`. */
export function presetContext(): Record<string, { filePath: string }> {
  return Object.fromEntries(PRESET_STEMS.map(name => [name, { filePath: presetFilePath(name) }]))
}
