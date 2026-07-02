import type { ConnectorContext } from '@gemstack/connectors'

const API = 'https://www.googleapis.com/drive/v3'

/** Thrown when the Google Drive API returns a non-2xx response. */
export class GoogleDriveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleDriveError'
  }
}

function bearer(ctx: ConnectorContext): string {
  const token = ctx.auth.token
  if (!token) {
    throw new GoogleDriveError(
      401,
      'no Google access token available — provide an OAuth bearer via the mount `credentials` option',
    )
  }
  return token
}

/**
 * Minimal Google Drive REST (v3) client over global `fetch`. The bearer comes
 * from the connector context (`ctx.auth.token`) — a Google OAuth 2.0 access
 * token. No SDK dependency, so the connector stays light.
 */
export async function gd<T = unknown>(
  ctx: ConnectorContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = bearer(ctx)
  const res = await gdFetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, `${method} ${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new GoogleDriveError(
      res.status,
      `${method} ${path} -> ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** GET a file's raw bytes as text (for `alt=media` downloads and Docs exports). */
export async function gdText(ctx: ConnectorContext, path: string): Promise<string> {
  const token = bearer(ctx)
  const res = await gdFetch(`${API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, `GET ${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new GoogleDriveError(res.status, `GET ${path} -> ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return await res.text()
}

/** `fetch`, but a transport failure (DNS, timeout, offline) is rethrown as a `GoogleDriveError` (`status: 0`) instead of a raw `TypeError`. */
async function gdFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (cause) {
    throw new GoogleDriveError(0, `${label} -> network error: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
