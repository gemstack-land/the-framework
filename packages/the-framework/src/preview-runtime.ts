import { resolveRunCheckout } from './store/index.js'
import { startPreview, detectServeTargets, type PreviewHandle, type ServeTarget } from './preview.js'
import type { PreviewResult, PreviewStatus } from './dashboard/index.js'
import type { PreviewHandlers } from './dashboard/telefunc-serve.js'
import { scopedKey } from './runtime-keys.js'
import { errorMessage } from './error-message.js'

/** Inputs to {@link createPreviewRuntime}. */
export interface PreviewRuntimeOptions {
  /** The daemon's home id, so a request with no project id targets the home workspace. */
  homeId: string
  /** Resolve a project id to its checkout path (or the home `cwd`); shared with the run runtime. */
  resolveProject: (id: string | undefined) => Promise<string | undefined>
}

/** The preview surface the dashboard drives, plus the teardown that outlives the daemon. */
export interface PreviewRuntime {
  /** The Preview handler set (#475/#797), handed to the dashboard as one value so `runId` survives. */
  preview: PreviewHandlers
  /** Stop every live preview so their dev servers do not outlive the daemon (#475). */
  dispose: () => Promise<void>
}

/**
 * On-demand app preview (#475), one long-lived preview process per project (plus one per session that
 * asks, #797), kept alive across the request that opens it and the Stop that closes it. Split out of
 * the project runtime because it shares nothing with the run half but the project resolver and the
 * key scheme: previews know nothing about runs, and the run half reaches in only to stop a finished
 * run's preview.
 *
 * Track a preview under its key and evict it the moment it stops serving (stop, or a self-exit: crash
 * / build error / the user killing it), so status never reports a dead URL and the idempotent open
 * below never hands back a corpse instead of restarting.
 *
 * Since #797 the key carries the session too, because a session serves its OWN worktree: one preview
 * per project as before, plus one per session that asks for it, each pointing at the tree it belongs
 * to. Keyed by project alone, a session's Serve booted the project's checkout and showed you code
 * that session never wrote.
 */
export function createPreviewRuntime({ homeId, resolveProject }: PreviewRuntimeOptions): PreviewRuntime {
  const activePreviews = new Map<string, PreviewHandle>()
  const trackPreview = (key: string, handle: PreviewHandle): void => {
    activePreviews.set(key, handle)
    void handle.exited.then(() => {
      if (activePreviews.get(key) === handle) activePreviews.delete(key)
    })
  }
  // The app the user last served per project (#651), so re-serving a monorepo picks it again
  // without re-choosing. In-memory: a live preview already rehydrates via onPreviewStatus, and
  // the pick resets on daemon restart (the picker still lists everything).
  const lastServeTarget = new Map<string, string>()
  const onServeTargets = async (targetProjectId?: string, runId?: string): Promise<ServeTarget[]> => {
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return []
    // Detected in the checkout that will actually be served: a session's branch may have added or
    // removed a servable package, and offering the project's list would offer apps it cannot serve.
    const serveCwd = await resolveRunCheckout(projectCwd, runId)
    return detectServeTargets(serveCwd).catch(() => [])
  }
  const onPreview = async (targetProjectId?: string, targetId?: string, runId?: string): Promise<PreviewResult> => {
    const projectKey = targetProjectId ?? homeId
    const key = scopedKey(projectKey, runId)
    const existing = activePreviews.get(key)
    if (existing) return { ok: true, url: existing.url, command: existing.command }
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    const serveCwd = await resolveRunCheckout(projectCwd, runId)
    try {
      // Resolve the pick: an explicit choice, else the one remembered from last time. Both are
      // matched against the live target list so a stale/unknown id falls back to the root default.
      // The memory is per project, not per session: which app you serve is a property of the repo.
      const wantId = targetId ?? lastServeTarget.get(projectKey)
      const target = wantId ? (await detectServeTargets(serveCwd).catch(() => [])).find(t => t.id === wantId) : undefined
      const handle = await startPreview(target ? { cwd: serveCwd, target } : { cwd: serveCwd })
      // A racing second open won the slot while we were booting: keep theirs, drop ours.
      const raced = activePreviews.get(key)
      if (raced) {
        await handle.stop().catch(() => {})
        return { ok: true, url: raced.url, command: raced.command }
      }
      if (target) lastServeTarget.set(projectKey, target.id)
      trackPreview(key, handle)
      return { ok: true, url: handle.url, command: handle.command }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }
  const onStopPreview = async (targetProjectId?: string, runId?: string): Promise<void> => {
    const key = scopedKey(targetProjectId ?? homeId, runId)
    const handle = activePreviews.get(key)
    if (!handle) return
    activePreviews.delete(key)
    await handle.stop().catch(() => {})
  }
  const onPreviewStatus = (targetProjectId?: string, runId?: string): PreviewStatus => {
    const handle = activePreviews.get(scopedKey(targetProjectId ?? homeId, runId))
    return handle ? { running: true, url: handle.url, command: handle.command } : { running: false }
  }

  const dispose = async (): Promise<void> => {
    await Promise.all([...activePreviews.values()].map(p => p.stop().catch(() => {})))
    activePreviews.clear()
  }

  return {
    preview: { start: onPreview, targets: onServeTargets, stop: onStopPreview, status: onPreviewStatus },
    dispose,
  }
}
