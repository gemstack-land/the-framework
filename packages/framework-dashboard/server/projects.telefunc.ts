import { defaultProjectsProvider, type ProjectSummary } from '@gemstack/framework'

// Spike (#406): the Projects sidebar over a Telefunc RPC. Reads the same global
// registry (#390) the daemon and CLI write — id, path, name, activated, last
// activity. This is the "does Telefunc feel better than hand-rolled fetch" half of
// the spike; the event stream is the SSE half (server/events-sse.ts).
export async function onProjects(): Promise<ProjectSummary[]> {
  return defaultProjectsProvider().list()
}
