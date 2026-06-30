import type { ConnectorContext } from '@gemstack/connectors'

const API = 'https://api.github.com'

/** Thrown when the GitHub API returns a non-2xx response. */
export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/**
 * Minimal GitHub REST client over global `fetch`. The bearer token comes from
 * the connector context (`ctx.auth.token`) — a PAT or an OAuth token; GitHub
 * accepts either as `Authorization: Bearer`. No SDK dependency, so the connector
 * stays light.
 */
export async function gh<T = unknown>(
  ctx: ConnectorContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = ctx.auth.token
  if (!token) {
    throw new GitHubError(
      401,
      'no GitHub token available — set GITHUB_TOKEN or provide one via the mount `credentials` option',
    )
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gemstack-connector-github',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new GitHubError(res.status, `${method} ${path} -> ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
