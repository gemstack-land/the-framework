import type { ExecOptions, ExecResult } from '../runner/types.js'
import type { DeployResult, DeployTarget, DeployTargetContext, RenderMode } from './types.js'

/**
 * The slice of a {@link RunnerSession} the Cloudflare adapter needs: a shell to
 * run install / build / `wrangler` in the workspace the app was built in. A full
 * `RunnerSession` satisfies this structurally, so the caller passes the same
 * session it handed to the build step.
 */
export interface DeployExecutor {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>
}

/** Which Cloudflare product to ship to. `auto` maps the render mode: SSR → Workers, SSG/SPA → Pages. */
export type CloudflareProduct = 'auto' | 'workers' | 'pages'

/** Options for {@link cloudflareTarget}. */
export interface CloudflareTargetOptions {
  /** The workspace to build + deploy in — the session the build wrote to. */
  session: DeployExecutor
  /** Cloudflare API token. Falls back to `CLOUDFLARE_API_TOKEN` in the environment. */
  apiToken?: string
  /** Cloudflare account id. Falls back to `CLOUDFLARE_ACCOUNT_ID` in the environment. */
  accountId?: string
  /** Pages project name (required for a Pages deploy). */
  projectName?: string
  /** Force a product instead of deriving it from the render mode. Default `'auto'`. */
  product?: CloudflareProduct
  /** Built static output directory for a Pages deploy. Default `dist/client` (Vike). */
  outputDir?: string
  /** Install command. Default `npm install`. Set `false` to skip (already installed). */
  installCommand?: string | false
  /** Build command. Default `npm run build`. Set `false` to skip (already built). */
  buildCommand?: string | false
  /** Extra arguments appended to the `wrangler` command. */
  wranglerArgs?: readonly string[]
  /** Per-command timeout in ms, passed to `exec`. */
  timeoutMs?: number
  /** Target name, matched against {@link DeployPlan.target}. Default `'cloudflare'`. */
  name?: string
}

const DEFAULT_INSTALL = 'npm install'
const DEFAULT_BUILD = 'npm run build'
const DEFAULT_OUTPUT_DIR = 'dist/client'
// wrangler prints the live deployment URL; grab the last workers.dev / pages.dev URL it emits.
const URL_RE = /https?:\/\/[^\s'"]+\.(?:workers|pages)\.dev[^\s'"]*/g

/** Last ~500 chars of a command's stderr (or stdout), for a compact failure detail. */
function tail(result: ExecResult): string {
  const text = (result.stderr || result.stdout || '').trim()
  return text.length > 500 ? `…${text.slice(-500)}` : text
}

/** SSR needs a server (Workers); prebuilt SSG and client-only SPA go to Pages. */
function productFor(render: RenderMode, override: CloudflareProduct): 'workers' | 'pages' {
  if (override !== 'auto') return override
  return render === 'ssr' ? 'workers' : 'pages'
}

/**
 * A real {@link DeployTarget} that ships the built app to Cloudflare via the
 * `wrangler` CLI, run inside the build's runner session. It installs, builds, and
 * deploys — to **Workers** for SSR or **Pages** for SSG/SPA — then reports the
 * live URL wrangler printed.
 *
 * It never throws: a missing token, a failed build, or a failed deploy come back
 * as `{ deployed: false, detail }` so the final phase can narrate the outcome
 * rather than crashing the app that was already built.
 *
 * Credentials come from `apiToken` / `accountId` (or `CLOUDFLARE_API_TOKEN` /
 * `CLOUDFLARE_ACCOUNT_ID`) and are passed to `wrangler` through the command
 * environment, so they work the same whether the session is local or a container.
 *
 * ```ts
 * deploy: agentDeploy(deployer, {
 *   target: cloudflareTarget({ session, projectName: 'orders-app' }),
 * })
 * ```
 */
export function cloudflareTarget(options: CloudflareTargetOptions): DeployTarget {
  const {
    session,
    projectName,
    product = 'auto',
    outputDir = DEFAULT_OUTPUT_DIR,
    wranglerArgs = [],
    timeoutMs,
    name = 'cloudflare',
  } = options
  const installCommand = options.installCommand === undefined ? DEFAULT_INSTALL : options.installCommand
  const buildCommand = options.buildCommand === undefined ? DEFAULT_BUILD : options.buildCommand

  return {
    name,
    async deploy(ctx: DeployTargetContext): Promise<DeployResult> {
      const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN
      const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
      if (!apiToken) {
        return {
          deployed: false,
          detail: 'no Cloudflare API token — set CLOUDFLARE_API_TOKEN or pass apiToken.',
        }
      }

      const target = productFor(ctx.plan.render, product)
      if (target === 'pages' && !projectName) {
        return {
          deployed: false,
          detail: 'a Pages deploy needs a project name — pass projectName.',
        }
      }

      const base: ExecOptions = timeoutMs != null ? { timeoutMs } : {}

      // Install + build in the workspace (no credentials needed for these).
      if (installCommand) {
        const installed = await session.exec(installCommand, base)
        if (installed.exitCode !== 0) {
          return { deployed: false, detail: `install failed (\`${installCommand}\`): ${tail(installed)}` }
        }
      }
      if (buildCommand) {
        const built = await session.exec(buildCommand, base)
        if (built.exitCode !== 0) {
          return { deployed: false, detail: `build failed (\`${buildCommand}\`): ${tail(built)}` }
        }
      }

      // Deploy with credentials passed through the command environment.
      const env: Record<string, string> = { CLOUDFLARE_API_TOKEN: apiToken }
      if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId
      const extra = wranglerArgs.length ? ` ${wranglerArgs.join(' ')}` : ''
      const command =
        target === 'workers'
          ? `npx wrangler deploy${extra}`
          : `npx wrangler pages deploy ${outputDir} --project-name ${projectName}${extra}`

      const shipped = await session.exec(command, { ...base, env })
      if (shipped.exitCode !== 0) {
        return { deployed: false, detail: `wrangler failed (\`${command}\`): ${tail(shipped)}` }
      }

      const urls = `${shipped.stdout}\n${shipped.stderr}`.match(URL_RE)
      const url = urls?.[urls.length - 1]
      return {
        deployed: true,
        ...(url ? { url } : {}),
        detail: url
          ? `Deployed to Cloudflare ${target} at ${url}`
          : `Deployed to Cloudflare ${target} (no URL found in wrangler output).`,
      }
    },
  }
}
