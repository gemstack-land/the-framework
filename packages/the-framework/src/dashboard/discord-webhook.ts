import { clampContent } from '../discord/rest.js'

/**
 * The one Discord *webhook* transport (#627): a single POST of one message. The two
 * notification posters (activity, interventions) each carried their own copy of this fetch;
 * their line formatters rightly stay beside the types they switch on, but the transport is
 * not per-feed. Deliberately not in discord/rest.ts — that module is the bot-token API
 * (channels, replies), and a webhook needs no token and reaches one fixed channel — though
 * it shares that module's clamp: Discord rejects a message over 2000 chars outright, so an
 * unclamped "needs you" batch would silently post nothing (#940).
 *
 * Resolves whether Discord accepted the post. A failed delivery must never throw out of a
 * daemon watcher, so a non-ok response and a network error both resolve `false` for the
 * caller to log.
 */
export async function postDiscordWebhook(webhook: string, content: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: clampContent(content) }),
    })
    return res.ok
  } catch {
    return false
  }
}
