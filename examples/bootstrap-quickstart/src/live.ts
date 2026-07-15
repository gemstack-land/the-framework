import { AiRegistry, AnthropicProvider, agent } from '@gemstack/ai-sdk'
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
  builtinPresetRegistry,
  CodeOverviewMaintainer,
  LocalRunner,
  runnerTools,
  launchAutopilot,
  type BootstrapEvent,
  type BootstrapResult,
  type Planner,
  type RunnerSession,
} from '@gemstack/ai-autopilot'
import { INTENT, formatBootstrapEvent, type CapstoneResult } from './bootstrap.js'

/**
 * The LIVE half of the capstone (#124): the same flow as `bootstrap.ts`, but with
 * the fakes swapped for real infra — a real model via `@gemstack/ai-sdk` and a real
 * `LocalRunner` sandbox on the host filesystem. The build workers and the deploy
 * decision are all model-driven; the workers write REAL files into a real temp
 * workspace. This is the honest "zero to a scaffolded app" proof that the offline
 * run (AiFake + FakeRunner) can only assert structurally.
 *
 * Scoped for a first, bounded, cheap proof: the production-grade loop keeps the same
 * scripted verdict as the offline example (blocks once on "no auth", then clears),
 * so the run is deterministic and does not spend model budget on the checklist.
 * Making the checklist a real reviewer agent is the natural follow-up.
 *
 * Run it: `ANTHROPIC_API_KEY=… pnpm start:live` (any provider ai-sdk knows works via
 * GEMSTACK_MODEL, e.g. `GEMSTACK_MODEL=anthropic/claude-haiku-4-5-20251001`).
 */

/** The model to drive the live run. Cheap + fast by default; override via env. */
const MODEL = process.env['GEMSTACK_MODEL'] ?? 'anthropic/claude-haiku-4-5-20251001'

/** The project we detect a framework from — Vike here, so the Vike preset wins. */
const PROJECT_DEPS = { 'vike-react': '1.0.0', react: '18.0.0', '@prisma/client': '1.0.0' }

/** The build plan: three subtasks, each owned by a worker (by name). The real
 *  worker decides the file contents; only the decomposition is fixed. */
const WORK = [
  { worker: 'data-modeler', description: 'Define the orders schema and a migration in database/schema.ts' },
  { worker: 'page-builder', description: 'Build pages/orders/+Page.jsx: a server-rendered, paginated list of orders' },
  { worker: 'ui-designer', description: 'Express the orders list as intent (a +config.js meta), not hardcoded markup' },
] as const
const livePlanner: Planner = () => WORK.map(w => ({ description: w.description, worker: w.worker }))

/** Register the Anthropic provider from the environment key. Throws with a clear
 *  message if the key is missing, so a bad env fails loudly rather than at request time. */
export function registerModel(): void {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) throw new Error('[live capstone] set ANTHROPIC_API_KEY (a model key) in the environment')
  AiRegistry.register(new AnthropicProvider({ apiKey }))
}

/** The worker roster: the role name the plan routes to, and how that agent is briefed. */
function roster(framework: string) {
  return [
    { name: 'data-modeler', role: 'You design database schemas and migrations.' },
    { name: 'page-builder', role: `You build pages and their routing for ${framework}.` },
    { name: 'ui-designer', role: 'You design the UI for a page.' },
  ]
}

/** One real worker agent per role, each with hands (runner tools) in the sandbox. */
function buildWorkers(session: RunnerSession, framework: string) {
  const sandbox = runnerTools(session)
  return Object.fromEntries(
    roster(framework).map(w => [
      w.name,
      agent({ model: MODEL, instructions: `${w.role} Write your work to disk with your tools.`, tools: sandbox }),
    ]),
  )
}

/** The full-fledged loop: the checklist blocks once, then clears after the fix (scripted). */
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

/**
 * The deploy step. With `CLOUDFLARE_API_TOKEN` set, it ships for real: the model
 * decides SSR/SSG/SPA and `cloudflareTarget` installs → builds → deploys the app
 * to Cloudflare (Workers for SSR, Pages for SSG/SPA) and reports the live URL.
 * Without a token it falls back to `planOnlyTarget` (decide + narrate, no ship),
 * so the run works with only a model key.
 */
function deployStep(session: RunnerSession, deployer: ReturnType<typeof agent>) {
  if (process.env['CLOUDFLARE_API_TOKEN']) {
    return agentDeploy(deployer, {
      targets: ['cloudflare'],
      target: cloudflareTarget({ session, projectName: process.env['CLOUDFLARE_PROJECT'] ?? 'gemstack-orders-demo' }),
    })
  }
  return agentDeploy(deployer)
}

/** Snapshot the real workspace into a { path: contents } map. */
async function snapshot(session: RunnerSession): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const path of await session.fs.list()) {
    files[path] = await session.fs.read(path)
  }
  return files
}

/**
 * Run the live capstone once against a real model + LocalRunner and return everything
 * the surfaces exposed. Disposes the temp workspace when done.
 */
export async function runLiveCapstone(write: (line: string) => void = () => {}): Promise<CapstoneResult> {
  registerModel()

  // 0. Preset: detect the framework from the project's deps to brief the workers.
  const { preset, detection } = builtinPresetRegistry().select({ dependencies: PROJECT_DEPS })

  // Runner: a REAL isolated workspace on the host filesystem, seeded with a minimal project.
  const runner = new LocalRunner()
  const session = await runner.boot({ files: { 'package.json': JSON.stringify({ name: 'orders-app' }) + '\n' } })

  try {
    const loop = buildLoop()

    const handle = launchAutopilot<BootstrapEvent, BootstrapResult>(onEvent =>
      new Bootstrap({
        onEvent: e => {
          write(formatBootstrapEvent(e))
          onEvent(e)
        },
        steps: {
          scope: () => ({ scope: 'full', intent: INTENT }),
          build: supervisorBuild({ plan: livePlanner, workers: buildWorkers(session, preset.framework), concurrency: 1 }),
          checklist: loopChecklist({ loop }),
          improve: loopImprove({ loop }),
          // Real Cloudflare deploy when CLOUDFLARE_API_TOKEN is set, else plan-only.
          deploy: deployStep(session, agent({ model: MODEL, instructions: 'deployer' })),
        },
      }).run(),
    )
    const result = await handle.result()
    const files = await snapshot(session)

    // Scale mode: generate CODE-OVERVIEW.md from the real scaffold (a material change).
    const maintainer = new CodeOverviewMaintainer({
      regenerate: () => ({
        summary: 'A server-rendered orders app on Vike + Prisma.',
        sections: [{ title: 'Structure', body: Object.keys(files).map(f => `- \`${f}\``).join('\n') }],
      }),
    })
    await maintainer.handle({ kind: 'major-change', summary: 'scaffolded the app', paths: Object.keys(files) })

    return { detection, result, events: handle.events(), files, overview: maintainer.get() }
  } finally {
    await session.dispose()
  }
}
