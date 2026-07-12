import { defaultProjectsProvider, type ProjectSummary } from '../dashboard/projects.js'

// The Projects sidebar behind the new dashboard (#405): the global registry (#390) the
// daemon and CLI write — id, path, name, activated, last activity. The live event
// stream is its own Telefunc Channel (events.telefunc.ts).
export async function onProjects(): Promise<ProjectSummary[]> {
  return defaultProjectsProvider().list()
}
