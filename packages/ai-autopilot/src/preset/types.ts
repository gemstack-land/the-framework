import type { Loop } from '../loop/types.js'
import type { Prompt } from '../prompts/types.js'
import type { Skill } from '../extensions/types.js'

/**
 * The Open Loop bundle unit (#204, #242): a **domain preset** ties together the
 * three data types the framework already ships separately into one selectable,
 * composable thing.
 *
 * - **loops** ({@link Loop}) — the meta prompts: which prompt chains fire for
 *   which change kinds.
 * - **prompts** ({@link Prompt}) — the prompt bodies (frontmatter + markdown) the
 *   loops dispatch by id.
 * - **skills** ({@link Skill}) — the framing knowledge: an `llms.txt` pointer plus
 *   any curated personas.
 *
 * A preset is authored in code with {@link defineDomainPreset} or loaded from a
 * directory of `.md` files with {@link loadDomainPreset}. Presets compose
 * ({@link composeDomainPresets}), so presets-of-presets falls out for free.
 *
 * This is deliberately distinct from the framework `Preset` in `presets/` (a
 * project *detector* that points at a framework skill) — that one is skipped for
 * the Open Loop MVP; this is the user-picked domain bundle.
 */
export interface DomainPreset {
  /** Stable kebab-case id (e.g. `software-development`). */
  readonly name: string
  /** Human title for display (e.g. `Software Development`). */
  readonly title: string
  /** One-line summary of the domain this preset covers. */
  readonly description: string
  /** The meta prompts: event-kind to prompt-chain mappings. */
  readonly loops: readonly Loop[]
  /** The prompt bodies the loops dispatch by id. */
  readonly prompts: readonly Prompt[]
  /** The framing knowledge (llms.txt pointers + personas). */
  readonly skills: readonly Skill[]
}

/** Author-facing shape for {@link defineDomainPreset}; every content field defaults to empty, `title` to `name`. */
export interface DomainPresetSpec {
  name: string
  title?: string
  description?: string
  loops?: readonly Loop[]
  prompts?: readonly Prompt[]
  skills?: readonly Skill[]
}

/** Identity fields for a composed preset — the merge of its parts is derived, only the label is new. */
export interface DomainPresetMeta {
  name: string
  title?: string
  description?: string
}
