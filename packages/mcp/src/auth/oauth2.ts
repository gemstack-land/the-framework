/**
 * OAuth 2.1 bearer-token protection for an MCP web endpoint, framework-agnostic.
 *
 * The core does NOT know how to verify a token — that is the app's job. Supply
 * a {@link VerifyToken} via {@link OAuth2McpOptions.verifyToken}: it validates
 * the JWT (signature, expiry, revocation — whatever your authorization server
 * requires) and returns the token's claims, or `null` / throws when the token
 * is invalid. Back it with any JWT library (e.g. `jose`), a hosted introspection
 * endpoint, or a framework's auth integration.
 *
 * On failure the middleware adds an RFC 9728 `WWW-Authenticate` header pointing
 * clients at the protected-resource metadata document (see
 * {@link registerOAuth2Metadata}).
 */

/** Claims returned by a successful {@link VerifyToken}. Extra claims pass through. */
export interface VerifiedToken {
  /** Subject (user id) claim, if present. */
  sub?: string
  /** Granted scopes. The wildcard `'*'` grants all scopes. */
  scopes?: string[]
  [claim: string]: unknown
}

/**
 * Verifies a bearer token and returns its claims, or `null` / throws when the
 * token is invalid. A thrown `Error`'s message is surfaced in the challenge
 * (e.g. `throw new Error('Token has been revoked.')`); `null` yields a generic
 * "Invalid or expired token." response.
 */
export type VerifyToken = (jwt: string) => Promise<VerifiedToken | null> | VerifiedToken | null

export interface OAuth2McpOptions {
  /** Scopes required on the bearer token. Missing scopes → 403 `insufficient_scope`. */
  scopes?: string[]
  /** Canonical URL of this protected MCP resource. Defaults to the current request URL. */
  resource?: string
  /** Authorization server URL(s) advertised via RFC 9728. Defaults to the app origin. */
  authorizationServers?: string[]
  /** Scopes advertised in the protected-resource metadata document. */
  scopesSupported?: string[]
  /** Token verifier. Required for the endpoint to accept any token (see {@link VerifyToken}). */
  verifyToken?: VerifyToken
  /**
   * Honour `X-Forwarded-Host` / `X-Forwarded-Proto` when building the metadata
   * URL. Off by default: those headers are client-supplied unless a trusted
   * proxy overwrites them, and the URL is what clients follow to authenticate.
   * Enable it only when this endpoint is reachable solely through such a proxy.
   */
  trustProxy?: boolean
}

/** Minimal Connect-style request shape the middleware reads. */
export interface OAuth2Request {
  headers: Record<string, string | string[] | undefined>
  protocol?: string
  host?: string
  hostname?: string
  [key: string]: unknown
}

/** Minimal Connect-style response shape the middleware writes to. */
export interface OAuth2Response {
  status(code: number): { json(data: unknown): void }
  header?(key: string, value: string): void
}

export type OAuth2Next = () => unknown | Promise<unknown>
export type OAuth2Middleware = (req: OAuth2Request, res: OAuth2Response, next: OAuth2Next) => Promise<void>

/** Auth context attached to the request after a successful verification. */
export interface McpAuthContext {
  sub?: string
  scopes?: string[]
  claims: VerifiedToken
}

/**
 * Protect an MCP web endpoint with OAuth 2.1 Bearer tokens. On success the
 * verified claims are attached to the request as `req.mcpAuth`
 * ({@link McpAuthContext}) and `next()` is called.
 */
export function oauth2McpMiddleware(mcpPath: string, options: OAuth2McpOptions = {}): OAuth2Middleware {
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath}`
  const requiredScopes = options.scopes ?? []
  const verifyToken = options.verifyToken

  return async function OAuth2McpMiddleware(req, res, next) {
    const authHeader = getHeader(req, 'authorization')
    const metadataUrl = absoluteUrl(req, metadataPath, options.trustProxy === true)

    if (!authHeader?.startsWith('Bearer ')) {
      challenge(res, metadataUrl, 'invalid_token', 'Bearer token required.')
      return
    }

    if (!verifyToken) {
      challenge(res, metadataUrl, 'invalid_token', 'OAuth provider not configured.')
      return
    }

    const jwt = authHeader.slice(7).trim()
    if (!jwt) {
      challenge(res, metadataUrl, 'invalid_token', 'Bearer token required.')
      return
    }

    let claims: VerifiedToken | null
    try {
      claims = await verifyToken(jwt)
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Invalid or expired token.'
      challenge(res, metadataUrl, 'invalid_token', msg)
      return
    }
    if (!claims) {
      challenge(res, metadataUrl, 'invalid_token', 'Invalid or expired token.')
      return
    }

    if (requiredScopes.length > 0) {
      const tokenScopes = Array.isArray(claims.scopes) ? claims.scopes : []
      const granted = tokenScopes.includes('*')
      if (!granted) {
        const missing = requiredScopes.filter((s) => !tokenScopes.includes(s))
        if (missing.length > 0) {
          challenge(res, metadataUrl, 'insufficient_scope',
            `Missing scope(s): ${missing.join(', ')}`,
            requiredScopes.join(' '))
          return
        }
      }
    }

    const auth: McpAuthContext = {
      ...(claims.sub !== undefined ? { sub: claims.sub } : {}),
      ...(claims.scopes !== undefined ? { scopes: claims.scopes } : {}),
      claims,
    }
    ;(req as Record<string, unknown>)['mcpAuth'] = auth

    await next()
  }
}

/** Register the RFC 9728 Protected Resource Metadata endpoint for an MCP path. */
export function registerOAuth2Metadata(
  router: {
    get(path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]): unknown
  },
  mcpPath: string,
  options: OAuth2McpOptions,
): void {
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath}`

  router.get(metadataPath, (req: unknown, res: unknown) => {
    const origin = absoluteUrl(req as OAuth2Request, '', options.trustProxy === true)
    const resource = options.resource ?? `${origin}${mcpPath}`
    const authServers = options.authorizationServers && options.authorizationServers.length > 0
      ? options.authorizationServers
      : [origin]

    const body: Record<string, unknown> = {
      resource,
      authorization_servers: authServers,
      bearer_methods_supported: ['header'],
    }
    if (options.scopesSupported && options.scopesSupported.length > 0) {
      body['scopes_supported'] = options.scopesSupported
    }

    ;(res as { json: (data: unknown) => void }).json(body)
  })
}

// ─── helpers ──────────────────────────────────────────────

/** A bare `host[:port]`, either a registered name / IPv4 or a bracketed IPv6 literal. */
const HOST_PATTERN = /^(?:[a-zA-Z0-9._-]+|\[[0-9a-fA-F:.]+\])(?::\d{1,5})?$/

function absoluteUrl(req: OAuth2Request, path: string, trustProxy: boolean): string {
  const host = (trustProxy ? validHost(firstValue(getHeader(req, 'x-forwarded-host'))) : undefined)
    ?? validHost(req.host)
    ?? validHost(getHeader(req, 'host'))
    ?? validHost(req.hostname)
    ?? 'localhost'
  const proto = (trustProxy ? validProto(firstValue(getHeader(req, 'x-forwarded-proto'))) : undefined)
    ?? validProto(req.protocol)
    ?? 'http'
  return `${proto}://${host}${path}`
}

/** A chain of proxies appends to `X-Forwarded-*`; the client-facing hop is first. */
function firstValue(raw: string | undefined): string | undefined {
  return raw?.split(',')[0]?.trim() || undefined
}

function validHost(raw: string | undefined): string | undefined {
  return raw !== undefined && HOST_PATTERN.test(raw) ? raw : undefined
}

function validProto(raw: string | undefined): string | undefined {
  const proto = raw?.replace(/:$/, '').toLowerCase()
  return proto === 'http' || proto === 'https' ? proto : undefined
}

/**
 * Escape a value for an RFC 7235 quoted-string. Backslashes go BEFORE quotes:
 * otherwise a value ending in `\` would let the trailing backslash escape the
 * closing quote and inject extra auth-params. Order matters, `\` → `\\`, then
 * `"` → `\"`.
 */
function escapeQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getHeader(req: OAuth2Request, name: string): string | undefined {
  const v = req.headers[name]
  if (Array.isArray(v)) return v[0]
  return v
}

function challenge(
  res: OAuth2Response,
  metadataUrl: string,
  error: 'invalid_token' | 'insufficient_scope',
  description: string,
  scope?: string,
): void {
  const parts: string[] = [`resource_metadata="${escapeQuoted(metadataUrl)}"`, `error="${error}"`]
  if (description) parts.push(`error_description="${escapeQuoted(description)}"`)
  if (scope) parts.push(`scope="${escapeQuoted(scope)}"`)
  res.header?.('WWW-Authenticate', `Bearer ${parts.join(', ')}`)

  const statusCode = error === 'insufficient_scope' ? 403 : 401
  const body: Record<string, unknown> = { error, error_description: description }
  if (scope) body['scope'] = scope
  res.status(statusCode).json(body)
}
