import { AiFake, agent, type ToolCall } from '@gemstack/ai-sdk'
import {
  Supervisor,
  agentPlanner,
  stackPersonas,
  personaRoster,
  personaInstructions,
  personaTools,
  FakeRunner,
  runnerTools,
  terminalSink,
  launchAutopilot,
  type RunnerSession,
  type SupervisorEvent,
  type SupervisorRun,
} from '@gemstack/ai-autopilot'

/**
 * The end-to-end shape of the ai-autopilot epic, in one flow:
 *
 *   personas  →  Supervisor  →  runner (sandbox)  →  surfaces
 *
 * A lead planner decomposes a build task and routes each subtask to a
 * stack-aware **persona**; the **Supervisor** dispatches them; each persona
 * worker acts inside a **runner** sandbox (writing Vike/ORM files via
 * `runnerTools`); progress is rendered through the **surfaces** (a terminal
 * sink plus a background handle with a live stream).
 *
 * It runs offline: `AiFake` scripts the model, so there is no API key and the
 * output is deterministic. Swapping `FakeRunner` for a real runner and dropping
 * the fake is the only change needed to run it for real.
 */

/** The feature we ask autopilot to build. */
export const TASK = 'Add a paginated Orders page backed by an orders table'

/** Each subtask, the persona that should own it, and the file it writes. */
const WORK = [
  {
    worker: 'data-modeler',
    description: 'Define the orders schema and a migration',
    file: 'database/schema.ts',
    contents: "export const orders = table('orders', { id: id(), total: integer(), createdAt: timestamp() })\n",
  },
  {
    worker: 'vike-page-builder',
    description: 'Build the /orders page that lists orders, paginated',
    file: 'pages/orders/+Page.jsx',
    contents: "export default function Page({ orders }) { return <OrderList orders={orders} /> }\n",
  },
  {
    worker: 'ui-intent-designer',
    description: 'Express the orders list as intent, not hardcoded markup',
    file: 'pages/orders/+config.js',
    contents: "export default { meta: { OrderList: { env: { server: true, client: true } } } }\n",
  },
] as const

/** Script the fake: step 0 is the planner's JSON; then each worker writes its file. */
function scriptModel(fake: AiFake): void {
  const plannerOutput = JSON.stringify(WORK.map(w => ({ description: w.description, worker: w.worker })))
  const workerSteps = WORK.flatMap((w, i) => {
    const toolCalls: ToolCall[] = [
      { id: `write-${i}`, name: 'write_file', arguments: { path: w.file, contents: w.contents } },
    ]
    return [{ toolCalls }, { text: `Wrote ${w.file}` }]
  })
  // concurrency: 1 makes the provider-call order deterministic:
  // 0 = planner, then each worker's (tool-call, final-text) pair in plan order.
  fake.respondWithSequence([{ text: plannerOutput }, ...workerSteps])
}

/** Build one worker agent per persona, each with hands inside the sandbox. */
function personaWorkersWithSandbox(session: RunnerSession): Record<string, ReturnType<typeof agent>> {
  const sandbox = runnerTools(session)
  return Object.fromEntries(
    stackPersonas.map(p => [
      p.name,
      agent({ instructions: personaInstructions(p), tools: [...personaTools(p), ...sandbox] }),
    ]),
  )
}

export interface QuickstartResult {
  run: SupervisorRun
  /** Every event, in order (from the background handle). */
  events: SupervisorEvent[]
  /** Files the workers wrote into the sandbox. */
  files: Record<string, string>
  /** Output of the post-build `exec`. */
  build: { stdout: string; exitCode: number }
  /** The preview URL the sandbox exposed. */
  previewUrl: string
}

/**
 * Run the whole flow once and return everything the surfaces exposed.
 *
 * @param write where terminal-surface lines go (default: no-op; `main.ts` prints).
 */
export async function runQuickstart(write: (line: string) => void = () => {}): Promise<QuickstartResult> {
  const fake = AiFake.fake()
  scriptModel(fake)
  try {
    // Runner: an in-memory sandbox seeded with a minimal Vike project.
    const runner = new FakeRunner({
      onExec: cmd =>
        cmd.includes('build')
          ? { stdout: 'orders page built', stderr: '', exitCode: 0 }
          : { stdout: '', stderr: '', exitCode: 0 },
    })
    const session = await runner.boot({ files: { 'package.json': '{ "name": "shop" }\n' } })

    // Personas → Supervisor. The planner is told the roster so it routes by role.
    const planner = agentPlanner(
      agent(`You are the lead engineer. Decompose the task and route each subtask to a persona.\n\n${personaRoster(stackPersonas)}`),
    )
    const start = (onEvent: (e: SupervisorEvent) => void) =>
      new Supervisor({
        plan: planner,
        workers: personaWorkersWithSandbox(session),
        concurrency: 1,
        onEvent,
      }).run(TASK)

    // Surfaces: one run feeds both the terminal (live) and a background handle.
    const terminal = terminalSink({ write })
    const handle = launchAutopilot(onEvent =>
      start(e => {
        terminal(e)
        onEvent(e)
      }),
    )
    const run = await handle.result()

    // Runner again: build the app and grab a preview URL.
    const build = await session.exec('pnpm build')
    const preview = session.preview ? await session.preview({ port: 5173 }) : { url: '' }

    return {
      run,
      events: handle.events(),
      files: session.snapshot(),
      build: { stdout: build.stdout, exitCode: build.exitCode },
      previewUrl: preview.url,
    }
  } finally {
    fake.restore()
  }
}
