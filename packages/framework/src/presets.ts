import { join } from 'node:path'
import {
  PRESETS_MAINTAINABILITY,
  PRESETS_READABILITY,
  PRESETS_SECURITY_AUDIT,
  PRESETS_RESEARCH,
  PRESETS_UX,
} from './prompts.generated.js'
import { THE_FRAMEWORK_DIR } from './logs.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * The quality preset prompts (#326), keyed by file stem. The stem is both the on-disk name
 * and the `tf.presets.<stem>` key the on-before-mergeable prompt reads: Rom's OP writes
 * `tf.presets.security_audit.filePath`, so the key is the underscore file stem, not the
 * hyphenated run-kind name (`SECURITY_AUDIT_PRESET_NAME` is `security-audit`).
 */
export const PRESETS: Readonly<Record<string, string>> = {
  maintainability: PRESETS_MAINTAINABILITY,
  readability: PRESETS_READABILITY,
  security_audit: PRESETS_SECURITY_AUDIT,
  research: PRESETS_RESEARCH,
  ux: PRESETS_UX,
}

/** Where the materialized presets live under a repo's `.the-framework/` (#326). */
export const PRESET_DIR = `${THE_FRAMEWORK_DIR}/presets`

/**
 * The workspace-relative path a materialized preset lives at, e.g.
 * `.the-framework/presets/maintainability.md`. A on-before-mergeable TODO entry carries this as
 * `tf.presets.<name>.filePath`, and the agent opens it. Workspace-relative, because that
 * is the agent's cwd.
 */
export function presetFilePath(name: string): string {
  return `${PRESET_DIR}/${name}.md`
}

/** The `tf.presets` map the on-before-mergeable prompt reads: stem -> `{ filePath }`. */
export function presetContext(): Record<string, { filePath: string }> {
  return Object.fromEntries(Object.keys(PRESETS).map(name => [name, { filePath: presetFilePath(name) }]))
}

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
