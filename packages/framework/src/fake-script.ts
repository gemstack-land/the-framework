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
}

const TURNS: FakeTurn[] = [
  { text: '```json\n' + JSON.stringify(ARCHITECT) + '\n```', actions: ['Read'] },
  {
    text: 'Built the orders app: an orders schema and migration, a paginated /orders page, and a sign-in stub.',
    actions: ['Write', 'Write', 'Bash'],
  },
  {
    text: 'Reviewed the app.\n```json\n{ "blockers": ["No authentication on the orders page yet"] }\n```',
    actions: ['Read', 'Grep'],
  },
  { text: 'Added a +guard to the orders page (vike-auth) so it requires a signed-in user.', actions: ['Edit'] },
  { text: 'Reviewed again.\n```json\n{ "blockers": [] }\n```', actions: ['Read'] },
]

/** Build the scripted {@link FakeDriver} for the demo. */
export function fakeDriver(): FakeDriver {
  return new FakeDriver({ turns: TURNS, sessionId: 'fake-orders-app' })
}
