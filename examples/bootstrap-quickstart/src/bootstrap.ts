import { AiFake, agent, type ToolCall } from '@gemstack/ai-sdk'
import {
  Bootstrap,
  supervisorBuild,
  loopChecklist,
  loopImprove,
  agentDeploy,
  cloudflareTarget,
  LoopEngine,
  definePrompt,
  defineLoop,
  builtinFrameworkPresetRegistry,
  CodeOverviewMaintainer,
  FakeRunner,
  runnerTools,
  launchAutopilot,
  type BootstrapEvent,
  type BootstrapResult,
  type CodeOverview,
  type FrameworkDetection,
  type Planner,
  type RunnerSession,
} from '@gemstack/ai-autopilot'

/**
 * The capstone: the whole AI-framework epic in one offline flow.
 *
 *   detect framework (preset)  →  Bootstrap
 *     scope → build → full-fledged loop → deploy
 *   → scale mode (CODE-OVERVIEW.md)
 *
 * A **preset** detects the project's framework from its dependencies, so the
 * build's workers are briefed on the right one. **Bootstrap** then sequences the
 * flow: it asks one scoping question, **builds** the app with those workers inside
 * a **runner** sandbox, runs the **full-fledged loop** until the production-grade
 * checklist's `{ blockers }` verdict is empty, and **decides a deploy** behind the
 * `DeployTarget` seam. What stack to build on is the build agent's call, not ours.
 * Every phase streams as narration over the generic **surface**. Finally **scale
 * mode** generates `CODE-OVERVIEW.md` from the scaffold.
 *
 * It runs offline: `AiFake` scripts the model and `FakeRunner` is an in-memory
 * sandbox, so there is no API key and the output is deterministic. `live.ts` runs
 * the same flow for real (a real model + `LocalRunner` writing files to disk) — the
 * live proof for #124.
 */

/** What the user wants built (the one thing scope asks about). */
export const INTENT = 'A paginated Orders page backed by an orders table, with sign-in.'

/** The project we detect a framework from — Vike here, so the Vike preset wins. */
const PROJECT_DEPS = { 'vike-react': '1.0.0', react: '18.0.0', '@prisma/client': '1.0.0' }

/** Each build subtask, the worker that owns it, and the file it writes. */
const WORK = [
  {
    worker: 'data-modeler',
    description: 'Define the orders schema and a migration',
    file: 'database/schema.ts',
    contents: "export const orders = table('orders', { id: id(), total: integer(), createdAt: timestamp() })\n",
  },
  {
    worker: 'page-builder',
    description: 'Build the /orders page that lists orders, paginated',
    file: 'pages/orders/+Page.jsx',
    contents: "export default function Page({ orders }) { return <OrderList orders={orders} /> }\n",
  },
  {
    worker: 'ui-designer',
    description: 'Express the orders list as intent, not hardcoded markup',
    file: 'pages/orders/+config.js',
    contents: "export default { meta: { OrderList: { env: { server: true, client: true } } } }\n",
  },
] as const

/** The deploy decision (what `agentDeploy` parses). SSR → Cloudflare Workers. */
const DEPLOY_DECISION = { render: 'ssr', target: 'cloudflare', reason: 'per-request orders data + server-side auth' }

/** The URL the simulated `wrangler` prints, so the offline demo ends at a live-looking URL. */
const DEPLOY_URL = 'https://orders-app.gemstack.workers.dev'

/**
 * Script the fake provider. Order (concurrency 1) is: each build worker's
 * (write-file tool call, final text) pair, then the deploy decision. The
 * full-fledged loop uses scripted local prompts, not the model.
 */
function scriptModel(fake: AiFake): void {
  const workerSteps = WORK.flatMap((w, i) => {
    const toolCalls: ToolCall[] = [
      { id: `write-${i}`, name: 'write_file', arguments: { path: w.file, contents: w.contents } },
    ]
    return [{ toolCalls }, { text: `Wrote ${w.file}` }]
  })
  fake.respondWithSequence([...workerSteps, { text: JSON.stringify(DEPLOY_DECISION) }])
}

/** A static planner: the build subtasks, in the order the fake scripts them. */
const staticPlanner: Planner = () => WORK.map(w => ({ description: w.description, worker: w.worker }))

/** The worker roster: the role name the plan routes to, and how that agent is briefed. */
function roster(framework: string) {
  return [
    { name: 'data-modeler', role: 'Design database schemas and migrations.' },
    { name: 'page-builder', role: `Build pages and their routing for ${framework}.` },
    { name: 'ui-designer', role: 'Design the UI for a page.' },
  ]
}

/** Build one worker agent per role, each with hands inside the sandbox. */
function buildWorkers(session: RunnerSession, framework: string) {
  const sandbox = runnerTools(session)
  return Object.fromEntries(roster(framework).map(w => [w.name, agent({ instructions: w.role, tools: sandbox })]))
}

/** The full-fledged loop: the checklist blocks once, then clears after the fix. */
function buildLoop(): LoopEngine {
  const verdicts = [
    '```json\n{ "blockers": ["No authentication on the orders page yet"] }\n```',
    '```json\n{ "blockers": [] }\n```',
  ]
  let pass = 0
  return new LoopEngine({
    loops: [
      defineLoop({ on: 'production-check', run: ['production-grade'] }),
      defineLoop({ on: 'major-change', run: ['address-blockers'] }),
    ],
    prompts: [
      definePrompt({ id: 'production-grade', run: () => verdicts[Math.min(pass++, verdicts.length - 1)]! }),
      definePrompt({ id: 'address-blockers', run: () => 'Added a +guard to the orders page (vike-auth).' }),
    ],
  })
}

/** Everything the capstone exposes, for the runnable demo and the smoke test. */
export interface CapstoneResult {
  detection: FrameworkDetection
  result: BootstrapResult
  events: BootstrapEvent[]
  files: Record<string, string>
  overview: CodeOverview | undefined
}

/** Render a bootstrap event as one human-readable narration line. */
export function formatBootstrapEvent(event: BootstrapEvent): string {
  switch (event.type) {
    case 'scope':
      return `▶ scope: ${event.scope} — "${event.intent}"`
    case 'narrate':
      return `  ${event.message}`
    case 'build':
      return `    build/${event.event.type}`
    case 'checklist':
      return event.passing
        ? `  ✓ checklist pass ${event.pass}: production-grade`
        : `  ✗ checklist pass ${event.pass}: ${event.blockers.join('; ')}`
    case 'improve':
      return `  → improving: ${event.blockers.join('; ')}`
    case 'deploy':
      return `▶ deploy: ${event.plan.render.toUpperCase()} → ${event.plan.target} (${event.plan.reason})`
    case 'done':
      return `✓ done: ${event.result.productionGrade ? 'production-grade' : 'prototype'} in ${event.result.passes} pass(es)`
  }
}

/**
 * Run the whole capstone once and return everything the surfaces exposed.
 *
 * @param write where narration lines go (default: no-op; `main.ts` prints).
 */
export async function runCapstone(write: (line: string) => void = () => {}): Promise<CapstoneResult> {
  const fake = AiFake.fake()
  scriptModel(fake)
  try {
    // 0. FrameworkPreset: detect the framework from the project's deps to brief the workers.
    const { preset, detection } = builtinFrameworkPresetRegistry().select({ dependencies: PROJECT_DEPS })

    // Runner: an in-memory sandbox seeded with a minimal project. `wrangler` is
    // simulated (prints a live-looking URL) so the real cloudflareTarget adapter
    // runs its full path — install → build → deploy → parse URL — offline.
    const runner = new FakeRunner({
      onExec: cmd => {
        if (cmd.includes('wrangler')) return { stdout: `Published orders-app\n${DEPLOY_URL}`, stderr: '', exitCode: 0 }
        return { stdout: cmd.includes('build') ? 'built' : '', stderr: '', exitCode: 0 }
      },
    })
    const session = await runner.boot({ files: { 'package.json': JSON.stringify({ name: 'orders-app' }) + '\n' } })

    const loop = buildLoop()
    // The real Cloudflare adapter, run over the simulated wrangler above. A fake
    // token lets it proceed offline; the live capstone passes a real one.
    const deployTarget = cloudflareTarget({
      session,
      apiToken: process.env['CLOUDFLARE_API_TOKEN'] ?? 'demo-token',
      projectName: 'orders-app',
    })

    // Surfaces: run bootstrap detached; the terminal prints as events stream.
    const handle = launchAutopilot<BootstrapEvent, BootstrapResult>(onEvent =>
      new Bootstrap({
        onEvent: e => {
          write(formatBootstrapEvent(e))
          onEvent(e)
        },
        steps: {
          scope: () => ({ scope: 'full', intent: INTENT }),
          build: supervisorBuild({ plan: staticPlanner, workers: buildWorkers(session, preset.framework), concurrency: 1 }),
          checklist: loopChecklist({ loop }),
          improve: loopImprove({ loop }),
          deploy: agentDeploy(agent({ instructions: 'deployer' }), { target: deployTarget }),
        },
      }).run(),
    )
    const result = await handle.result()
    const files = session.snapshot()

    // Scale mode: generate CODE-OVERVIEW.md from the scaffold (a material change).
    const maintainer = new CodeOverviewMaintainer({
      regenerate: () => ({
        summary: 'A server-rendered orders app on Vike + Prisma.',
        sections: [
          { title: 'Structure', body: '- `pages/orders/` — the paginated orders page\n- `database/` — the orders schema + migrations' },
          { title: 'Conventions', body: 'Data goes through the Prisma client; pages stay thin.' },
        ],
      }),
    })
    await maintainer.handle({ kind: 'major-change', summary: 'scaffolded the app', paths: [...Object.keys(files), 'package.json'] })

    return { detection, result, events: handle.events(), files, overview: maintainer.get() }
  } finally {
    fake.restore()
  }
}
