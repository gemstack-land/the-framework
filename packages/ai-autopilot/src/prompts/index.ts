/**
 * The built-in prompts library — stack-aware prompt bodies, shipped as data.
 *
 * Load the built-ins with {@link builtinLibrary} (or {@link loadPromptsFrom} for
 * your own directory), then materialize them into loop prompts with
 * {@link loopPromptsFor} so `defaultLoops()` ids resolve to real bodies. Each
 * prompt is a {@link Prompt}: frontmatter + a markdown instructions body a
 * contributor can improve without touching code.
 */
export { parsePrompt, PromptError } from './parse.js'
export {
  PromptLibrary,
  builtinPrompts,
  builtinLibrary,
  builtinPromptsDir,
  loadPromptsFrom,
} from './library.js'
export {
  promptInstructions,
  renderTask,
  toLoopPrompt,
  loopPromptsFor,
  type MakePromptAgent,
  type PromptAgentContext,
} from './bridge.js'
export type { Prompt } from './types.js'
