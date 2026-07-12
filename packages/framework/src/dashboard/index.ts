export { startDashboard, parseStartOptions, type Dashboard, type DashboardOptions, type StartRunKind, type StartRunOptions, type StartRunResult, type AddProjectResult } from './server.js'
export {
  summarizeProject,
  defaultProjectsProvider,
  type ProjectSummary,
  type ProjectsProvider,
  type SummarizeDeps,
} from './projects.js'
export { dashboardHtml } from './page.js'
export { readDocs, DOC_CATEGORIES, type WorkspaceDoc } from './docs.js'
