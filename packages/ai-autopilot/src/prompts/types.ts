/**
 * The built-in prompts library — the stack-aware prompt *bodies* the loop
 * dispatches, shipped as data so they are turnkey and the community can improve
 * them with a PR.
 *
 * A {@link Prompt} is a parsed markdown bundle: frontmatter (name, description,
 * and `metadata` for title / loop id / passes / event) plus the instructions
 * body. The bodies live as `.md` files under the package's `prompts/` directory,
 * loaded at runtime; nothing here is executable, so a non-core contributor edits
 * prose, not code. Persona (#98) is the *role*; a prompt is the *task*.
 */

/** A parsed, ready-to-use prompt bundle. */
export interface Prompt {
  /** Dispatch id the loop references (kebab-case); `metadata.loopId` or `name`. */
  readonly id: string
  /** The bundle's manifest name (its file/frontmatter name). */
  readonly name: string
  /** Human title for display (`metadata.title`, falling back to the name). */
  readonly title: string
  /** One-line summary from frontmatter. */
  readonly description: string
  /** The markdown instructions body. */
  readonly instructions: string
  /** Fresh-context passes the loop should run this prompt for. Default 1. */
  readonly passes: number
  /** The loop event kind this prompt belongs to, when it targets one. */
  readonly event?: string
  /** Stack hints (package names / globs) the prompt applies to. */
  readonly appliesTo: readonly string[]
}
