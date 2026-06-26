/**
 * Match a URI against a template pattern like `weather://location/{city}`.
 * Returns extracted params or null if no match.
 *
 * Used by both the SDK runtime (`resources/read` template matching) and the
 * inspector's HTTP API. Keep the two in sync — duplicating this matcher caused
 * subtle drift in earlier revisions.
 */
export function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  const paramNames: string[] = []
  const regexStr = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  const match = uri.match(new RegExp(`^${regexStr}$`))
  if (!match) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]!] = decodeURIComponent(match[i + 1]!)
  }
  return params
}
