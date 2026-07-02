import type { DeployResult, DeployTarget, DeployTargetContext } from './types.js'

/** The `fetch` surface the adapter needs — global `fetch` satisfies it; tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Options for {@link dokployTarget}. */
export interface DokployTargetOptions {
  /** Base URL of the Dokploy instance, e.g. `https://dokploy.example.com` (a trailing `/api` is fine). */
  serverUrl: string
  /** The pre-configured Dokploy application to (re)deploy. */
  applicationId: string
  /** API token. Falls back to `DOKPLOY_AUTH_TOKEN`, then `DOKPLOY_API_KEY`, in the environment. */
  apiToken?: string
  /** Use `application.redeploy` (rebuild from scratch) instead of `application.deploy`. */
  redeploy?: boolean
  /** `fetch` implementation, injectable for tests. Defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Target name, matched against {@link DeployPlan.target}. Default `'dokploy'`. */
  name?: string
}

/** Normalize a base URL to `<origin>/api`, tolerating a trailing slash or an included `/api`. */
function apiBase(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
}

/**
 * A real {@link DeployTarget} that ships to a self-hosted [Dokploy](https://dokploy.com)
 * instance. Dokploy builds and serves the app server-side from its own configured
 * git source, so — unlike {@link cloudflareTarget}, which builds and uploads from
 * the session — this target just triggers a deployment over the Dokploy API
 * (`POST /api/application.deploy`) for a pre-configured application.
 *
 * It never throws: a missing token, a bad response, or a network failure come back
 * as `{ deployed: false, detail }`. Dokploy does not return the app's public URL
 * from the deploy trigger (the domain is configured on the Dokploy side), so a
 * successful result reports the triggered deployment rather than a URL.
 *
 * Credentials come from `apiToken` (or `DOKPLOY_AUTH_TOKEN` / `DOKPLOY_API_KEY`).
 *
 * ```ts
 * deploy: agentDeploy(deployer, {
 *   targets: ['dokploy'],
 *   target: dokployTarget({ serverUrl: 'https://dokploy.example.com', applicationId: 'app_123' }),
 * })
 * ```
 */
export function dokployTarget(options: DokployTargetOptions): DeployTarget {
  const { serverUrl, applicationId, redeploy = false, name = 'dokploy' } = options
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  return {
    name,
    async deploy(ctx: DeployTargetContext): Promise<DeployResult> {
      const apiToken = options.apiToken ?? process.env.DOKPLOY_AUTH_TOKEN ?? process.env.DOKPLOY_API_KEY
      if (!apiToken) {
        return { deployed: false, detail: 'no Dokploy API token — set DOKPLOY_AUTH_TOKEN or pass apiToken.' }
      }
      if (!serverUrl) return { deployed: false, detail: 'a Dokploy deploy needs a serverUrl.' }
      if (!applicationId) return { deployed: false, detail: 'a Dokploy deploy needs an applicationId.' }

      const endpoint = `${apiBase(serverUrl)}/application.${redeploy ? 'redeploy' : 'deploy'}`
      let res: Response
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'x-api-key': apiToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId, title: 'GemStack bootstrap deploy', description: ctx.plan.reason }),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        })
      } catch (cause) {
        return { deployed: false, detail: `Dokploy request failed: ${cause instanceof Error ? cause.message : String(cause)}` }
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { deployed: false, detail: `Dokploy deploy failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ''}` }
      }
      return {
        deployed: true,
        detail: `Triggered Dokploy ${redeploy ? 'redeploy' : 'deploy'} of application ${applicationId} on ${apiBase(serverUrl)}.`,
      }
    },
  }
}
