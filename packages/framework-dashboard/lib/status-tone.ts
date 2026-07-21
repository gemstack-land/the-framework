// The one color vocabulary for a run's status, shared by every list that shows one
// (the Runs rail, the project log) so the same status can never read as two colors.
export const STATUS_TONE: Record<string, string> = {
  running: 'text-primary',
  done: 'text-success',
  stopped: 'text-warning',
  failed: 'text-danger',
}
