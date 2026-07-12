export { startDashboard, isSameOriginRequest, type Dashboard, type DashboardOptions, type StartRunKind, type StartRunOptions, type StartRunResult, type AddProjectResult } from './server.js'
export {
  summarizeProject,
  defaultProjectsProvider,
  singleProjectProvider,
  emptyProjectsProvider,
  type ProjectSummary,
  type ProjectsProvider,
  type SummarizeDeps,
} from './projects.js'
export { resolveDashboardBundle } from './bundle.js'
export { makeTelefuncMount, type EventsSource } from './telefunc-serve.js'
export { serveClientBundle } from './static.js'
export { readDocs, DOC_CATEGORIES, type WorkspaceDoc } from './docs.js'
