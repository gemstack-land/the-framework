import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSkillManifest } from './manifest.js'
import { loadSkill, type LoadSkillOptions } from './loader.js'
import { fileExists } from './fs-utils.js'
import type { LoadedSkill, SkillManifest } from './types.js'

/** A discovered-but-not-yet-loaded skill: its manifest + where it lives. */
export interface SkillIndexEntry {
  manifest: SkillManifest
  dir: string
}

/** Options for {@link SkillRegistry.discover}. */
export interface DiscoverOptions {
  /**
   * Invoked when a candidate `SKILL.md` cannot be read or parsed. Discovery
   * always skips the offending entry and continues scanning the rest; this hook
   * lets you observe (log, collect) the skipped entries. Omit to skip silently.
   */
  onError?: (error: unknown, skillPath: string) => void
}

/**
 * Discovers `SKILL.md` bundles under a set of root directories and loads them
 * on demand. Discovery parses only the cheap frontmatter (the manifest), so
 * an app can index hundreds of skills and pull a skill's full body + tools
 * into memory only when it actually composes it — the progressive-disclosure
 * half of the skill model.
 *
 * Trust boundary: `discover()` only reads frontmatter and never executes skill
 * code. Code runs at `load()` time (it imports the tools module), so only call
 * `load()` on skills from trusted sources.
 */
export class SkillRegistry {
  private readonly entries = new Map<string, SkillIndexEntry>()
  private readonly loaded = new Map<string, LoadedSkill>()

  /**
   * Scan a directory whose immediate subdirectories each contain a `SKILL.md`,
   * indexing each by manifest `name`. Returns the entries found in this scan.
   * A later scan with a duplicate name overrides the earlier entry (last wins),
   * mirroring how registered/allowlisted sources layer.
   *
   * A single unreadable or malformed `SKILL.md` is skipped (not fatal) so one
   * bad bundle in a tree cannot break discovery of the rest; pass
   * {@link DiscoverOptions.onError} to observe what was skipped. This preserves
   * the "index hundreds of skills cheaply" contract: discovery only reads
   * frontmatter and never executes skill code.
   */
  async discover(root: string, opts: DiscoverOptions = {}): Promise<SkillIndexEntry[]> {
    const found: SkillIndexEntry[] = []
    let subdirs: string[]
    try {
      const dirents = await readdir(root, { withFileTypes: true })
      subdirs = dirents.filter(d => d.isDirectory()).map(d => join(root, d.name))
    } catch {
      return found
    }

    for (const dir of subdirs) {
      const skillPath = join(dir, 'SKILL.md')
      if (!(await fileExists(skillPath))) continue
      let manifest: SkillManifest
      try {
        ;({ manifest } = parseSkillManifest(await readFile(skillPath, 'utf8'), skillPath))
      } catch (err) {
        opts.onError?.(err, skillPath)
        continue
      }
      const entry: SkillIndexEntry = { manifest, dir }
      this.entries.set(manifest.name, entry)
      found.push(entry)
    }
    return found
  }

  /** All indexed (not necessarily loaded) entries, in insertion order. */
  list(): SkillIndexEntry[] {
    return [...this.entries.values()]
  }

  /** Look up an indexed entry by manifest name. */
  get(name: string): SkillIndexEntry | undefined {
    return this.entries.get(name)
  }

  /**
   * Fully load a discovered skill by name (parses the body, imports its tools
   * module, gathers resources). Cached: a second `load()` of the same name
   * returns the same instance unless `force` is set.
   */
  async load(name: string, opts: LoadSkillOptions & { force?: boolean } = {}): Promise<LoadedSkill> {
    const cached = this.loaded.get(name)
    if (cached && !opts.force) return cached

    const entry = this.entries.get(name)
    if (!entry) {
      const available = [...this.entries.keys()]
      const hint = available.length
        ? `available: ${available.join(', ')}`
        : 'no skills indexed yet — call discover() first'
      throw new Error(`[ai-skills] no skill named "${name}" has been discovered (${hint})`)
    }

    const skill = await loadSkill(entry.dir, opts)
    this.loaded.set(name, skill)
    return skill
  }

  /** Load several discovered skills by name, preserving the requested order. */
  async loadAll(names: string[], opts: LoadSkillOptions = {}): Promise<LoadedSkill[]> {
    return Promise.all(names.map(name => this.load(name, opts)))
  }
}
