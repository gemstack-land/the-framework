import { z } from 'zod'
import { toolDefinition } from './tool.js'
import type { ProviderHint } from './types.js'

/**
 * Best-effort HTML → plain text for the `web_fetch` tool. The result is handed
 * to the model as text content (never rendered as HTML), so this is content
 * extraction, not a security sanitizer.
 *
 * Implemented as a single linear scan (indexOf/startsWith), not a regex. A
 * regex tag-stripper trips every CodeQL HTML query — `<[^>]+>` is polynomial
 * ReDoS on `<<<<…`, and a `</script…>` end-tag regex is always "incomplete"
 * for some whitespace/junk variant. A character scan has none of those issues
 * and removes `<script>`/`<style>` element *content* (not just the tags) so it
 * never leaks into the extracted text.
 */
/** Sent by the `web_search` / `web_fetch` fallbacks. */
const USER_AGENT = 'gemstack-ai-sdk/1.0'

export function htmlToText(html: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt)
    // script/style: skip the whole element, including its text content.
    const skipTag = lower.startsWith('<script', lt) ? '</script'
      : lower.startsWith('<style', lt) ? '</style'
      : null
    if (skipTag) {
      const close = lower.indexOf(skipTag, lt)
      if (close === -1) break                 // unterminated → drop the rest
      const gt = html.indexOf('>', close)
      i = gt === -1 ? html.length : gt + 1
      continue
    }
    const gt = html.indexOf('>', lt)
    if (gt === -1) break                       // unterminated tag → drop the rest
    i = gt + 1
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Web search tool — uses provider-native web search when available.
 *
 * Native emission via `providerHint: { type: 'web-search', ... }`:
 *   - Anthropic adapter emits `{ type: 'web_search_20250305', name: 'web_search',
 *     max_uses?, allowed_domains? }`.
 *   - Google adapter emits a separate top-level tools entry `{ google_search: {} }`.
 *   - OpenAI's chat-completions surface has no equivalent (web_search is
 *     Responses-API-only) — falls through to the DuckDuckGo `server` execute
 *     below. Same fallback applies to any provider without a native hint match.
 *
 * Mirrors the Phase 2 file-search providerHint cascade — same plumbing,
 * different tool. `domains([...])` lowers to `allowed_domains` on Anthropic;
 * Gemini's `google_search` block doesn't accept domain restriction so the
 * `domains` opt is ignored there (the model still respects domain hints in
 * the prompt). `maxResults(n)` lowers to Anthropic's `max_uses`; ignored on
 * Gemini for the same reason.
 */
export class WebSearch {
  private _domains: string[] | undefined
  private _maxResults: number | undefined

  private constructor() {}

  static make(): WebSearch {
    return new WebSearch()
  }

  domains(domains: string[]): this {
    this._domains = domains
    return this
  }

  maxResults(n: number): this {
    this._maxResults = n
    return this
  }

  /** Convert to a tool definition that can be added to an agent's tools array */
  toTool() {
    const domains = this._domains
    const maxResults = this._maxResults

    const providerHint: ProviderHint = { type: 'web-search' }
    if (domains)              providerHint['allowed_domains'] = domains
    if (maxResults !== undefined) providerHint['max_uses']    = maxResults

    return toolDefinition({
      name: 'web_search',
      description: 'Search the web for current information.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
      }),
      providerHint,
      meta: {
        providerNative: true,
        type: 'web_search',
        domains,
        maxResults,
      },
    }).server(async ({ query }) => {
      // Fallback: simple server-side search via fetch
      // Runs only if the provider doesn't handle it natively
      try {
        const url = new URL('https://html.duckduckgo.com/html/')
        url.searchParams.set('q', query + (domains ? ` site:${domains.join(' OR site:')}` : ''))
        const res = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } })
        const html = await res.text()
        return { results: htmlToText(html).slice(0, 2000) }
      } catch {
        return { error: 'Web search unavailable' }
      }
    })
  }
}

/**
 * Web fetch tool — fetches a web page and returns its text content.
 */
export class WebFetch {
  private _maxLength: number | undefined

  private constructor() {}

  static make(): WebFetch {
    return new WebFetch()
  }

  maxLength(n: number): this {
    this._maxLength = n
    return this
  }

  toTool() {
    const maxLength = this._maxLength ?? 10000

    return toolDefinition({
      name: 'web_fetch',
      description: 'Fetch a web page and return its text content.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to fetch'),
      }),
      meta: {
        providerNative: true,
        type: 'web_fetch',
        maxLength,
      },
    }).server(async ({ url: targetUrl }) => {
      try {
        const res = await fetch(targetUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
        })
        const html = await res.text()
        const text = htmlToText(html).slice(0, maxLength)
        return { content: text, url: targetUrl, status: res.status }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Fetch failed', url: targetUrl }
      }
    })
  }
}

/**
 * Code execution tool — uses provider-native code interpreter when available.
 * No server-side fallback for security — returns an error if the provider
 * doesn't support native code execution.
 */
export class CodeExecution {
  private constructor() {}

  static make(): CodeExecution {
    return new CodeExecution()
  }

  toTool() {
    return toolDefinition({
      name: 'code_execution',
      description: 'Execute code to perform calculations, data analysis, or generate outputs.',
      inputSchema: z.object({
        code: z.string().describe('The code to execute'),
        language: z.string().default('javascript').describe('Programming language'),
      }),
      meta: {
        providerNative: true,
        type: 'code_execution',
      },
    }).server(async ({ code, language }) => {
      // No server-side fallback for security — must be handled by provider
      return {
        error: `Code execution requires a provider with native code interpreter support. Language: ${language}, code length: ${code.length}`,
      }
    })
  }
}
