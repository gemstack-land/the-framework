import {
  PRESETS_MAINTAINABILITY,
  PRESETS_READABILITY,
  PRESETS_SECURITY_AUDIT,
  PRESETS_RESEARCH,
  PRESETS_UX,
  PRESETS_MAINTENANCE,
} from './prompts.generated.js'
import { THE_FRAMEWORK_DIR } from './framework-dir.js'

/**
 * The preset registry: which presets exist and where they land on disk. Split out of `presets.ts`
 * (#874) so it stays free of `node:*` — a preset's own template can now reference
 * `tf.presets.<name>.filePath`, and presets render in the browser (#520). `materializePresets`,
 * which actually writes the files, stays behind in `presets.ts`.
 */

/**
 * The quality preset prompts (#326), keyed by file stem. The stem is both the on-disk name
 * and the `tf.presets.<stem>` key the prompts read: `tf.presets.security_audit.filePath` uses
 * the underscore file stem, not the hyphenated run-kind name (`security-audit`).
 */
export const PRESETS: Readonly<Record<string, string>> = {
  maintainability: PRESETS_MAINTAINABILITY,
  readability: PRESETS_READABILITY,
  security_audit: PRESETS_SECURITY_AUDIT,
  research: PRESETS_RESEARCH,
  ux: PRESETS_UX,
  maintenance: PRESETS_MAINTENANCE,
}

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
  return Object.fromEntries(Object.keys(PRESETS).map(name => [name, { filePath: presetFilePath(name) }]))
}
