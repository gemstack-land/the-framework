/**
 * The runner — the pluggable execution seam of `@gemstack/ai-autopilot`.
 *
 * A {@link Runner} boots an isolated workspace (filesystem + shell + optional
 * preview) where autopilot builds and runs an app. It is shaped after Flue's
 * `sandbox` so real sandboxes (WebContainer, Docker, Flue) drop in behind one
 * interface. This module ships the interface plus a {@link FakeRunner} for
 * tests; real adapters land separately.
 *
 * - {@link FakeRunner} — in-memory runner for tests (the runner analog of `AiFake`)
 * - {@link LocalRunner} — real host workspace (fs + child processes); the first real adapter
 * - {@link runnerTools} — expose a session to an agent as sandbox tools
 */
export type {
  Runner,
  RunnerSession,
  RunnerFs,
  FileTree,
  BootOptions,
  ExecOptions,
  ExecResult,
  Preview,
  PreviewOptions,
} from './types.js'
export { RunnerError } from './types.js'
export {
  FakeRunner,
  FakeRunnerSession,
  type FakeRunnerOptions,
  type FakeExec,
  type RecordedExec,
} from './fake.js'
export { LocalRunner, LocalRunnerSession, type LocalRunnerOptions } from './local.js'
export { runnerTools, type RunnerToolsOptions } from './tools.js'
