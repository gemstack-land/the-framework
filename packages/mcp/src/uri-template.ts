const PLACEHOLDER = /\{(\w+)\}/g

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match a URI against a template pattern like `weather://location/{city}`.
 * Returns extracted params or null if no match.
 *
 * Used by both the SDK runtime (`resources/read` template matching) and the
 * inspector's HTTP API. Keep the two in sync — duplicating this matcher caused
 * subtle drift in earlier revisions.
 */
export function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  // Escape between placeholders: an unescaped `.` widens the match and a stray `(` shifts the capture indexes.
  const paramNames: string[] = []
  let regexStr = ''
  let cursor = 0
  for (const m of template.matchAll(PLACEHOLDER)) {
    regexStr += escapeRegExp(template.slice(cursor, m.index)) + '([^/]+)'
    paramNames.push(m[1]!)
    cursor = m.index + m[0].length
  }
  regexStr += escapeRegExp(template.slice(cursor))

  const match = uri.match(new RegExp(`^${regexStr}$`))
  if (!match) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    let value: string
    try {
      value = decodeURIComponent(match[i + 1]!)
    } catch {
      // A malformed escape like `%zz` is a non-match, not a crash out of the caller's template loop.
      return null
    }
    // The guard has to hold after decoding too, or `%2F` smuggles a traversal past `([^/]+)`.
    if (value.includes('/')) return null
    params[paramNames[i]!] = value
  }
  return params
}
