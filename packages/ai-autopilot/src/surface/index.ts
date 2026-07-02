/**
 * Surfaces — run the same autopilot in the terminal, in an in-page UI, or as a
 * background process. All three consume the Supervisor's `onEvent` stream; they
 * differ only in how events are rendered and whether the run blocks.
 *
 * - {@link terminalSink} / {@link formatEvent} — the terminal surface (print inline)
 * - {@link EventStream} — replayable multi-consumer transport (in-page / background)
 * - {@link launchAutopilot} — the background surface: a detached {@link AutopilotHandle}
 */
export {
  EventStream,
  formatEvent,
  terminalSink,
  type TerminalSinkOptions,
} from './events.js'
export {
  launchAutopilot,
  type AutopilotHandle,
  type AutopilotStatus,
  type LaunchOptions,
} from './launch.js'
