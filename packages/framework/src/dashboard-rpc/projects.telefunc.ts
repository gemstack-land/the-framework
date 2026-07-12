import { getContext } from 'telefunc'
import { contextProjects } from './context.js'
import type { ProjectSummary } from '../dashboard/projects.js'
import type { AddProjectResult } from '../dashboard/server.js'
import type { DashboardContext } from '../dashboard/telefunc-serve.js'

// The Projects sidebar behind the new dashboard (#405): the global registry (#390) the
// daemon and CLI write — id, path, name, activated, last activity. The per-run
// foreground dashboard (#427) scopes this to a single project via the request context.
// The live event stream is its own Telefunc Channel (events.telefunc.ts).
export async function onProjects(): Promise<ProjectSummary[]> {
  return contextProjects().list()
}

/**
 * Add project(s) from the dashboard (#396/#433): install a single repo, or every git
 * repo under a directory, and register each so it joins the Projects list. Like
 * `sendStart` this needs the daemon (it spawns git + writes the shared registry), so it
 * calls the daemon's own `addProject` closure from the Telefunc request context. Returns
 * the daemon's {@link AddProjectResult}; a public host (the relay) leaves it unwired.
 */
export async function sendAddProject(path: string, directory: boolean): Promise<AddProjectResult> {
  const { addProject } = getContext<DashboardContext>()
  if (!addProject) return { ok: false, error: 'adding projects is not enabled on this server' }
  const trimmed = path.trim()
  if (!trimmed) return { ok: false, error: 'a project path is required' }
  return addProject(trimmed, directory)
}
