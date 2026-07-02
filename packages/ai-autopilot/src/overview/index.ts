/**
 * Scale mode — an always-current `CODE-OVERVIEW.md` the agent reads first in a
 * large repo, kept fresh by refreshing only on *material* changes (#114).
 *
 * - {@link CodeOverviewMaintainer} — holds the map, refreshes on material change
 * - {@link detectMaterialChange} — the deterministic trigger (build/test/layout)
 * - {@link agentOverview} — regenerate the map with an `ai-sdk` agent
 * - {@link overviewLoopPrompt} — drop the maintainer into the loop (#113)
 * - {@link parseOverview} / {@link serializeOverview} — the `CODE-OVERVIEW.md` form
 * - {@link loadOverview} / {@link saveOverview} — persist over an {@link OverviewFs}
 */
export { CodeOverviewMaintainer, createOverviewMaintainer, type MaintainerOptions } from './maintainer.js'
export { detectMaterialChange, type DetectOptions } from './material.js'
export { agentOverview, overviewLoopPrompt, type AgentOverviewOptions, type OverviewLoopPromptOptions } from './agent.js'
export { parseOverview, serializeOverview } from './markdown.js'
export { loadOverview, saveOverview, nodeOverviewFs, OVERVIEW_FILE } from './store.js'
export type {
  CodeOverview,
  OverviewSection,
  MaterialChange,
  OverviewFs,
  RegenerateContext,
  Regenerate,
  OverviewRefresh,
  OverviewEvent,
} from './types.js'
