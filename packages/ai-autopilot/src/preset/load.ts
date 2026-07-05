import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseSkillManifest } from '@gemstack/ai-skills'
import { defineLoop } from '../loop/define.js'
import { defineSkill } from '../extensions/define.js'
import { loadPromptsFrom } from '../prompts/library.js'
import type { Loop } from '../loop/types.js'
import type { Skill } from '../extensions/types.js'
import { defineDomainPreset, DomainPresetError } from './define.js'
import type { DomainPreset } from './types.js'

/**
 * Load a {@link DomainPreset} from a directory of `.md` files — the no-code,
 * marketplace-shippable form. Layout:
 *
 * ```text
 * <dir>/
 *   preset.md          # required: name + description (frontmatter), metadata.title
 *   loops/*.md         # metadata.on (kind or kinds) + metadata.run (prompt ids)
 *   prompts/*.md       # prompt bodies (the existing prompt bundle format)
 *   skills/*.md        # metadata.url (llms.txt) + metadata.title; body ignored
 * ```
 *
 * The three content subdirectories are all optional — a missing one yields an
 * empty list. The preset's identity comes from `preset.md`.
 */
export async function loadDomainPreset(dir: string): Promise<DomainPreset> {
  const manifestPath = join(dir, 'preset.md')
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch {
    throw new DomainPresetError(`preset directory ${JSON.stringify(dir)} has no preset.md manifest`)
  }
  const { manifest } = parseSkillManifest(raw, manifestPath)
  const title = str(manifest.metadata, 'title')

  const [loops, prompts, skills] = await Promise.all([
    loadLoopsFrom(join(dir, 'loops')),
    loadPromptsIn(join(dir, 'prompts')),
    loadSkillsFrom(join(dir, 'skills')),
  ])

  return defineDomainPreset({
    name: manifest.name,
    ...(title ? { title } : {}),
    description: manifest.description,
    loops,
    prompts,
    skills,
  })
}

/** Absolute path to the package's shipped `presets/` directory. */
export function builtinPresetsDir(): string {
  // From dist/preset/load.js (and dist-test/…), the package root is two up.
  return fileURLToPath(new URL('../../presets/', import.meta.url))
}

/** The shipped, stack-agnostic "Software Development" domain preset (#243). */
export function softwareDevelopmentPreset(): Promise<DomainPreset> {
  return loadDomainPreset(join(builtinPresetsDir(), 'software-development'))
}

/** Load every `*.md` loop file in a directory (a missing directory yields `[]`). */
export async function loadLoopsFrom(dir: string): Promise<Loop[]> {
  const files = await mdFiles(dir)
  return Promise.all(
    files.map(async f => {
      const path = join(dir, f)
      const { manifest } = parseSkillManifest(await readFile(path, 'utf8'), path)
      const meta = manifest.metadata ?? {}
      const on = meta.on
      const run = meta.run
      if (on === undefined) throw new DomainPresetError(`loop ${JSON.stringify(path)} is missing metadata.on`)
      if (!Array.isArray(run)) throw new DomainPresetError(`loop ${JSON.stringify(path)} needs metadata.run to be a list`)
      return defineLoop({ on: on as string | string[], run: run as string[] })
    }),
  )
}

/** Load every `*.md` skill pointer in a directory (a missing directory yields `[]`). */
export async function loadSkillsFrom(dir: string): Promise<Skill[]> {
  const files = await mdFiles(dir)
  return Promise.all(
    files.map(async f => {
      const path = join(dir, f)
      const { manifest } = parseSkillManifest(await readFile(path, 'utf8'), path)
      const meta = manifest.metadata ?? {}
      const url = str(meta, 'url')
      if (!url) throw new DomainPresetError(`skill ${JSON.stringify(path)} is missing metadata.url (its llms.txt pointer)`)
      return defineSkill({
        name: manifest.name,
        title: str(meta, 'title') ?? manifest.name,
        description: manifest.description,
        url,
      })
    }),
  )
}

// ─── Internals ───────────────────────────────────────────────────

/** `*.md` filenames in a directory, sorted; `[]` when the directory does not exist. */
async function mdFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(f => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

/** Prompts subdir via the existing loader; a missing/empty dir yields `[]` while real parse errors still surface. */
async function loadPromptsIn(dir: string) {
  const files = await mdFiles(dir)
  return files.length ? loadPromptsFrom(dir) : []
}

function str(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
