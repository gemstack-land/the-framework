import { Output } from '@gemstack/ai-sdk'
import type { Agent } from '@gemstack/ai-sdk'
import { z } from 'zod'
import type {
  BootstrapSteps,
  DeployPlan,
  DeployResult,
  DeployTarget,
  DeployTargetContext,
  RenderMode,
} from './types.js'

/**
 * The deploy phase — decide SSR/SSG/SPA + a target, narrate the plan, and hand it
 * to a {@link DeployTarget}. Deciding is this module's job; *executing* the plan
 * is the target's, behind the adapter seam (the same shape as the runner seam).
 *
 * v1 ships only {@link planOnlyTarget} (decides + narrates, does not ship) and
 * {@link FakeDeployTarget} (tests). Real Dockploy / Cloudflare adapters implement
 * {@link DeployTarget} and are infra-gated follow-ups — so bootstrap never does a
 * blind deploy now.
 */

/** The target names the deploy step steers toward by default. */
export const DEFAULT_DEPLOY_TARGETS = ['dokploy', 'cloudflare'] as const

const RENDER_MODES: readonly RenderMode[] = ['ssr', 'ssg', 'spa']

/**
 * A plan-only {@link DeployTarget}: it reports that nothing was shipped, so the
 * flow decides + narrates without a blind deploy. This is the v1 default and the
 * reference implementation of the seam.
 */
export function planOnlyTarget(name = 'plan-only'): DeployTarget {
  return {
    name,
    deploy: () => ({
      deployed: false,
      detail: 'Decided and narrated only — no deploy adapter is wired (infra-gated).',
    }),
  }
}

/** Options for {@link FakeDeployTarget}. */
export interface FakeDeployTargetOptions {
  name?: string
  /** The result to return; defaults to a shipped result with a fake URL. */
  result?: DeployResult
}

/** An in-memory {@link DeployTarget} for tests: records the plan and returns a canned result. */
export class FakeDeployTarget implements DeployTarget {
  readonly name: string
  private readonly result: DeployResult
  /** Every plan handed to {@link deploy}, in order. */
  readonly deployed: DeployPlan[] = []

  constructor(opts: FakeDeployTargetOptions = {}) {
    this.name = opts.name ?? 'fake'
    this.result = opts.result ?? { deployed: true, url: 'https://fake.deploy.example', detail: 'fake deploy' }
  }

  deploy(ctx: DeployTargetContext): DeployResult {
    this.deployed.push(ctx.plan)
    return this.result
  }
}

/** Options for {@link agentDeploy}. */
export interface AgentDeployOptions {
  /** The target that executes the plan. Defaults to {@link planOnlyTarget} (v1). */
  target?: DeployTarget
  /** Allowed target names to steer the decision. Default {@link DEFAULT_DEPLOY_TARGETS}. */
  targets?: readonly string[]
  /** Override the deploy instruction prepended to the app context. */
  instructions?: string
}

const DEFAULT_DEPLOY_INSTRUCTIONS = `You are deciding how to ship this app. Choose the rendering mode and the deploy
target that fit what was built, and explain the choice in one line — act like an
engineer who decides, not one who asks. Pick SSR when pages need per-request data
or auth, SSG when content is mostly static and can be prebuilt, and SPA only when
the app is a client-side dashboard behind a login.`

/**
 * A deploy step backed by an `ai-sdk` agent: it asks for a structured
 * `{ render, target, reason }` decision (validated against the allowed render
 * modes + target names), then hands the plan to the {@link DeployTarget}. With no
 * target wired it uses {@link planOnlyTarget}, so v1 decides and narrates without
 * shipping.
 */
export function agentDeploy(deployer: Agent, opts: AgentDeployOptions = {}): NonNullable<BootstrapSteps['deploy']> {
  const targets = opts.targets && opts.targets.length ? opts.targets : DEFAULT_DEPLOY_TARGETS
  const target = opts.target ?? planOnlyTarget()
  const instructions = opts.instructions ?? DEFAULT_DEPLOY_INSTRUCTIONS
  const schema = z.object({
    render: z.enum(['ssr', 'ssg', 'spa']).describe('How the app is rendered/served'),
    target: z.string().describe(`One of: ${targets.join(', ')}`),
    reason: z.string().describe('One-line rationale'),
  })
  const output = Output.object({ schema })

  return async ({ plan: architecture, scope, intent, productionGrade, signal }) => {
    const context = [
      `# What the user wanted (${scope})`,
      intent,
      `# Stack`,
      architecture.stack,
      `# Production-grade`,
      productionGrade ? 'the app passed the production-grade checklist' : 'not yet fully production-grade',
      `# Allowed targets`,
      targets.join(', '),
    ].join('\n')
    const response = await deployer.prompt(`${instructions}\n\n${context}\n\n${output.toSystemPrompt()}`)
    const decided = output.parse(response.text ?? '')

    // Normalize the decision against the allowed sets so a stray value cannot slip through.
    const render: RenderMode = RENDER_MODES.includes(decided.render) ? decided.render : 'ssr'
    const targetName = targets.includes(decided.target) ? decided.target : targets[0]!
    const deployPlan: DeployPlan = { render, target: targetName, reason: decided.reason }

    const result = await target.deploy({ plan: deployPlan, intent, ...(signal ? { signal } : {}) })
    return { plan: deployPlan, result }
  }
}
