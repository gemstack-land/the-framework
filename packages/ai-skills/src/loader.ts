import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnyTool } from '@gemstack/ai-sdk'
import { parseSkillManifest, SkillManifestError } from './manifest.js'
import type { LoadedSkill, SkillResource } from './types.js'

/** Candidate filenames for a skill's co-located tools module, in priority order. */
const TOOLS_FILES = ['tools.js', 'tools.mjs', 'tools.cjs'] as const

export interface LoadSkillOptions {
  /**
   * Import the skill's co-located tools module and merge its `tool()` exports.
   * Defaults to `true`. Set `false` to load a skill's instructions + resources
   * *without* executing its tools module — useful for surface-before-compose
   * inspection of a skill you do not yet trust.
   */
  loadTools?: boolean
  /** Override the tools module filename (relative to the skill dir). */
  toolsFile?: string
}

/**
 * Load a single skill from a directory containing a `SKILL.md`.
 *
 * Loading is an explicit trust action: with `loadTools` on (the default) this
 * imports the skill's tools module, which runs its top-level code. Only load
 * skills from sources you trust. See the package README for the trust model.
 */
export async function loadSkill(dir: string, opts: LoadSkillOptions = {}): Promise<LoadedSkill> {
  const skillPath = join(dir, 'SKILL.md')

  let markdown: string
  try {
    markdown = await readFile(skillPath, 'utf8')
  } catch {
    throw new SkillManifestError(`no SKILL.md found in ${dir}`, dir)
  }

  const { manifest, instructions } = parseSkillManifest(markdown, skillPath)

  const tools = opts.loadTools === false ? [] : await loadSkillTools(dir, opts.toolsFile)
  const resources = await loadSkillResources(dir)

  return { manifest, instructions, tools, resources, dir }
}

/**
 * Load several skills, preserving order. Rejects if any single skill fails to
 * load (use {@link loadSkill} in a `Promise.allSettled` if you want partial
 * tolerance).
 */
export async function loadSkills(dirs: string[], opts: LoadSkillOptions = {}): Promise<LoadedSkill[]> {
  return Promise.all(dirs.map(dir => loadSkill(dir, opts)))
}

// ─── Internals ───────────────────────────────────────────────────

async function loadSkillTools(dir: string, toolsFile?: string): Promise<AnyTool[]> {
  const candidates = toolsFile ? [toolsFile] : TOOLS_FILES
  for (const file of candidates) {
    const path = join(dir, file)
    if (!(await fileExists(path))) continue
    const mod = await import(pathToFileURL(path).href) as Record<string, unknown>
    return collectTools(mod)
  }
  return []
}

/**
 * Pull `tool()` objects out of a module's exports. A value is treated as a tool
 * when it is shaped like `ai-sdk`'s `Tool` (an object carrying a
 * `definition.name`). Arrays of tools are flattened, so a module can
 * `export default [toolA, toolB]` or export them individually.
 */
function collectTools(mod: Record<string, unknown>): AnyTool[] {
  const out: AnyTool[] = []
  const seen = new Set<unknown>()
  for (const value of Object.values(mod)) {
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (isTool(candidate) && !seen.has(candidate)) {
        seen.add(candidate)
        out.push(candidate)
      }
    }
  }
  return out
}

function isTool(value: unknown): value is AnyTool {
  if (typeof value !== 'object' || value === null) return false
  const def = (value as { definition?: unknown }).definition
  return typeof def === 'object' && def !== null
    && typeof (def as { name?: unknown }).name === 'string'
}

async function loadSkillResources(dir: string): Promise<SkillResource[]> {
  const resourceDir = join(dir, 'resources')
  if (!(await isDirectory(resourceDir))) return []

  const entries = await readdir(resourceDir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile())
    .map(e => ({ name: basename(e.name), path: join(resourceDir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}
