/**
 * React client runtime for `@gemstack/ai-sdk`.
 *
 * The agent framework, providers, and the runtime-agnostic agent-SSE protocol
 * (`readAgentStream` + the server framers) live in the main `@gemstack/ai-sdk`
 * entry. This subpath adds the React hook that drives a streamed agent run from
 * a component — same split as `@rudderjs/sync/react` (the main entry stays
 * React-free; React lives behind `/react`).
 *
 * Peer requirement: `react@>=19.2.0`.
 */

export { useAgentRun } from './useAgentRun.js'
export type {
  AgentRunStatus,
  UseAgentRunOptions,
  UseAgentRunResult,
} from './useAgentRun.js'

// Framework-free core — exported so apps can drive a run outside React (or
// unit-test their own integration) and so the output/request types are nameable.
export {
  appendAgentOutput,
  executeClientTools,
  driveAgentRun,
} from './agent-run.js'
export type {
  AgentRunOutput,
  AgentToolResult,
  AgentRunRequest,
  AgentRunDriverOptions,
} from './agent-run.js'
