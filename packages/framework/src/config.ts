import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { errorMessage } from './error-message.js'

/**
 * The per-repo run defaults persisted in `the-framework.yml` (#204): which Open
 * Loop domain preset and modes a project builds under, so its config travels with
 * the code instead of being retyped as flags each run.
 */
export interface FrameworkFileConfig {
  /** Domain preset to run under, by name (e.g. `software-development`). */
  preset?: string
  /** Activate the preset's Autopilot mode variants. */
  autopilot?: boolean
  /** Activate the preset's Technical mode variants. */
  technical?: boolean
  /** Build event kind the preset's review loop fires for, e.g. `bug-fix` (#265). */
  event?: string
  /** Inject the built-in system prompt (#326, via #301). Default `true`; set false to remove it. */
  antiLazyPill?: boolean
  /**
   * Transparent mode (#625): make every run in this project a raw `claude -p` — no framework
   * system prompt, no emit protocols, no consumption guard, no dashboard, no TODO loop. The
   * coarse "only-pick-what-you-need" master off-switch, at the per-project tier. Default `false`.
   */
  transparent?: boolean
}

/** Config file names read from the workspace root, in precedence order. */
export const FRAMEWORK_CONFIG_FILES = ['the-framework.yml', 'the-framework.yaml'] as const

/** The string-valued config keys, parsed and copied across layers as-is. */
export const STRING_CONFIG_KEYS = ['preset', 'event'] as const
/**
 * The boolean-valued mode keys. This is the canonical mode list: parsing, the config-layer copy,
 * resolution, and the resolved-config summary all iterate it, so a new mode is added here once and
 * flows through them (only its default and any renamed output field are declared per key).
 */
export const BOOLEAN_CONFIG_KEYS = ['autopilot', 'technical', 'antiLazyPill', 'transparent'] as const
/** Every config key, string then boolean, in declaration order. */
export const CONFIG_KEYS = [...STRING_CONFIG_KEYS, ...BOOLEAN_CONFIG_KEYS] as const

/**
 * Read `the-framework.yml` (or `.yaml`) from a directory. A missing file yields
 * `{}`. Best-effort: a malformed file is reported via `onWarn` and treated as
 * empty, never a failed run. CLI flags override whatever this returns.
 */
export async function loadFrameworkConfig(
  dir: string,
  onWarn?: (message: string) => void,
): Promise<FrameworkFileConfig> {
  for (const name of FRAMEWORK_CONFIG_FILES) {
    let raw: string
    try {
      raw = await readFile(join(dir, name), 'utf8')
    } catch {
      continue // not this name; try the next
    }
    try {
      return parseFrameworkConfig(raw, name)
    } catch (err) {
      // parseFrameworkConfig already prefixes the file name in its message.
      onWarn?.(`ignoring ${errorMessage(err)}`)
      return {}
    }
  }
  return {}
}

/**
 * Parse and validate a `the-framework.yml` body into a {@link FrameworkFileConfig}.
 * An empty document is `{}`. Throws on a non-map document or a mistyped field so
 * {@link loadFrameworkConfig} can surface it as a warning.
 */
export function parseFrameworkConfig(raw: string, source = 'the-framework.yml'): FrameworkFileConfig {
  const data = parseYaml(raw) as unknown
  if (data == null) return {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${source} must be a YAML map of settings`)
  }
  const obj = data as Record<string, unknown>
  const config: FrameworkFileConfig = {}
  for (const key of STRING_CONFIG_KEYS) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== 'string') throw new Error(`${source}: "${key}" must be a string`)
      config[key] = obj[key] as string
    }
  }
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== 'boolean') throw new Error(`${source}: "${key}" must be a boolean`)
      config[key] = obj[key] as boolean
    }
  }
  return config
}
