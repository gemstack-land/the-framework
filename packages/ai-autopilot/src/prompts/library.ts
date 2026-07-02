import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parsePrompt } from './parse.js'
import type { Prompt } from './types.js'

/**
 * A set of {@link Prompt}s keyed by dispatch id, with lookup helpers. This is
 * what you hand to the loop (via `loopPromptsFor`) and what a UI lists.
 */
export class PromptLibrary {
  private readonly byId = new Map<string, Prompt>()

  constructor(prompts: readonly Prompt[] = []) {
    for (const p of prompts) this.byId.set(p.id, p)
  }

  /** The prompt with this dispatch id, or `undefined`. */
  get(id: string): Prompt | undefined {
    return this.byId.get(id)
  }

  /** All prompts, sorted by id for a stable order. */
  all(): Prompt[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /** The dispatch ids in the library. */
  ids(): string[] {
    return this.all().map(p => p.id)
  }

  /** Prompts that target a given loop event kind (e.g. `major-change`). */
  byEvent(kind: string): Prompt[] {
    return this.all().filter(p => p.event === kind)
  }

  /** Add or replace a prompt (e.g. a project's own body). Returns `this`. */
  add(prompt: Prompt): this {
    this.byId.set(prompt.id, prompt)
    return this
  }

  get size(): number {
    return this.byId.size
  }
}

/** Absolute path to the package's shipped `prompts/` directory. */
export function builtinPromptsDir(): string {
  // From dist/prompts/library.js (and dist-test/…), the package root is two up.
  return fileURLToPath(new URL('../../prompts/', import.meta.url))
}

/** Load every `*.md` prompt bundle in a directory, in filename order. */
export async function loadPromptsFrom(dir: string): Promise<Prompt[]> {
  const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort()
  return Promise.all(
    files.map(async f => {
      const path = join(dir, f)
      return parsePrompt(await readFile(path, 'utf8'), path)
    }),
  )
}

/** Load the built-in, stack-aware prompt bodies shipped with the package. */
export async function builtinPrompts(): Promise<Prompt[]> {
  return loadPromptsFrom(builtinPromptsDir())
}

/** The built-in prompts as a ready-to-use {@link PromptLibrary}. */
export async function builtinLibrary(): Promise<PromptLibrary> {
  return new PromptLibrary(await builtinPrompts())
}
