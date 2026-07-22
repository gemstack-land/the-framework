/**
 * The composite key scheme for the daemon runtime's per-project state (#736): `<projectKey>::<runId>`,
 * or the bare project key for a project-scoped entry (a fallback run with no worktree, a project's
 * preview). Built and parsed only here -- three call sites used to hand-roll the encoding, the prefix
 * match and the split separately -- and shared by the run runtime and the preview runtime, which both
 * key their state this way.
 */

/** Encode a run/preview key: project-scoped when `runId` is absent, else run-scoped. */
export const scopedKey = (projectKey: string, runId?: string): string => (runId ? `${projectKey}::${runId}` : projectKey)

/** The two halves of a {@link scopedKey}. */
export function parseScopedKey(key: string): { projectKey: string; runId?: string } {
  const separator = key.indexOf('::')
  return separator === -1 ? { projectKey: key } : { projectKey: key.slice(0, separator), runId: key.slice(separator + 2) }
}

/** Whether a {@link scopedKey} belongs to a project (its own entry, or one of its runs). */
export const keyBelongsTo = (key: string, projectKey: string): boolean => key === projectKey || key.startsWith(`${projectKey}::`)
