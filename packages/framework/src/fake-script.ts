import type { FrameworkSignals } from '@gemstack/ai-autopilot'
import { FakeDriver, type FakeTurn } from './driver/index.js'
import type { DeployDecision } from './run.js'

/**
 * The deterministic `--fake` scenario: a small Vike + Prisma orders app.
 * It wires a {@link FakeDriver} whose scripted turns walk the exact prompt order
 * the flow issues (architect JSON, build summary, checklist-with-blocker,
 * improve, clean checklist), so the whole scope -> deploy flow runs offline with
 * no CLI and no model, ending production-grade. Mirrors the ai-autopilot
 * bootstrap-quickstart, but driven entirely *through* the driver seam.
 */

/** The default intent the `--fake` demo builds. */
export const FAKE_INTENT = 'A paginated orders page backed by an orders table, with sign-in.'

/** Deps that make the Vike preset win detection in the demo. */
export const FAKE_SIGNALS: FrameworkSignals = {
  dependencies: { 'vike-react': '1.0.0', react: '18.0.0', '@prisma/client': '5.0.0' },
}

/** The deploy decision narrated at the end of the demo. */
export const FAKE_DEPLOY: DeployDecision = {
  render: 'ssr',
  target: 'cloudflare',
  reason: 'per-request orders data + server-side auth',
}

const ARCHITECT = {
  stack: 'Vike + Prisma on Postgres, with vike-auth',
  narration: 'Server-rendered orders app: Vike pages, a Prisma data layer, sessions via vike-auth.',
  decisions: [
    { choice: 'Prisma on Postgres', why: 'the orders catalog is relational and needs typed queries' },
    { choice: 'SSR over SPA', why: 'orders need per-request data and auth on the server' },
  ],
  pros: [
    'Deploys to the edge (Cloudflare) for low-latency per-request orders data',
    'Renderer-agnostic, so the UI is not locked to one framework',
  ],
  cons: ['Smaller ecosystem than Next.js', 'Fewer batteries-included conventions, so more is wired by hand'],
  alternatives: [{ option: 'Next.js', whyNot: 'more constrained Cloudflare/edge deploy for the per-request data path' }],
}

// A small, plausible per-turn usage so the demo shows spend accumulating (#322).
const FAKE_USAGE = { costUsd: 0.02, inputTokens: 1800, outputTokens: 600, cacheReadTokens: 12000, cacheCreationTokens: 800 }

const ARCHITECT_TURN: FakeTurn = { text: '```json\n' + JSON.stringify(ARCHITECT) + '\n```', actions: ['Read'], usage: FAKE_USAGE }
const BUILD_TURN: FakeTurn = {
  text: 'Built the orders app: an orders schema and migration, a paginated /orders page, and a sign-in stub.',
  actions: ['Write', 'Write', 'Bash'],
  usage: FAKE_USAGE,
}
const CHECKLIST_BLOCKER: FakeTurn = {
  text: 'Reviewed the app.\n```json\n{ "blockers": ["No authentication on the orders page yet"] }\n```',
  actions: ['Read', 'Grep'],
  usage: FAKE_USAGE,
}
const IMPROVE: FakeTurn = { text: 'Added a +guard to the orders page (vike-auth) so it requires a signed-in user.', actions: ['Edit'], usage: FAKE_USAGE }
const CHECKLIST_CLEAN: FakeTurn = { text: 'Reviewed again.\n```json\n{ "blockers": [] }\n```', actions: ['Read'], usage: FAKE_USAGE }

const TURNS: FakeTurn[] = [ARCHITECT_TURN, BUILD_TURN, CHECKLIST_BLOCKER, IMPROVE, CHECKLIST_CLEAN]

// Demo variants that make the build stop to ask, so the turn-boundary gates (#337
// single-select / #339 multi-select checklist) can be seen offline. The build turn ends
// with an await block; the framework shows the gate, waits, then re-prompts (RESUME_TURN),
// and the run continues to review as usual. Needs the dashboard on (so requestChoice is
// wired); selected via FRAMEWORK_FAKE_AWAIT=choices|multiselect|confirmation.
const AWAIT_CHOICES_TURN: FakeTurn = {
  text:
    'I need one decision before wiring auth.\n```await-choices\n' +
    '{ "title": "Which auth approach for the orders page?", "options": [{ "label": "Session cookies", "detail": "simple, server-side" }, { "label": "JWT", "detail": "stateless, more moving parts" }], "recommended": "Session cookies" }\n```',
  actions: ['Read'],
  usage: FAKE_USAGE,
}
const AWAIT_MULTISELECT_TURN: FakeTurn = {
  text:
    'Rated the problems by how clear the optimal solution is.\n```await-multiselect\n' +
    '{ "title": "Which problems should I deep-dive for alternatives?", "options": [{ "label": "auth model", "detail": "rated 3/10", "default": true }, { "label": "pagination", "detail": "rated 7/10" }, { "label": "orders schema", "detail": "rated 2/10", "default": true }] }\n```',
  actions: ['Read', 'Grep'],
  usage: FAKE_USAGE,
}
const AWAIT_CONFIRMATION_TURN: FakeTurn = {
  text:
    'The scope is large, so I wrote a plan first.\n```await-confirmation\n' +
    '{ "title": "Approve the plan for the orders app?", "file": "PLAN_fake-orders-app.agent.md" }\n```',
  actions: ['Write'],
  usage: FAKE_USAGE,
}
const RESUME_TURN: FakeTurn = { text: 'Applied your answer and finished building the orders app.', actions: ['Write', 'Bash'], usage: FAKE_USAGE }

/** Scripted turns for the demo, optionally routed through a turn-boundary gate. */
export function demoTurns(awaitMode: string | undefined): FakeTurn[] {
  const askTurn =
    awaitMode === 'choices' ? AWAIT_CHOICES_TURN
    : awaitMode === 'multiselect' ? AWAIT_MULTISELECT_TURN
    : awaitMode === 'confirmation' ? AWAIT_CONFIRMATION_TURN
    : undefined
  if (!askTurn) return TURNS
  // The build asks (askTurn), the gate resolves, the framework re-prompts (RESUME_TURN),
  // then the normal review turns follow.
  return [ARCHITECT_TURN, askTurn, RESUME_TURN, CHECKLIST_BLOCKER, IMPROVE, CHECKLIST_CLEAN]
}

/** Build the scripted {@link FakeDriver} for the demo. */
export function fakeDriver(): FakeDriver {
  return new FakeDriver({ turns: demoTurns(process.env.FRAMEWORK_FAKE_AWAIT), sessionId: 'fake-orders-app' })
}
