/**
 * The Discord REST calls the bot needs (#680). Separate from the outbound webhook posts in the
 * intervention/activity watchers (#627): a webhook can only speak into one channel and cannot
 * reply, so a bot that answers where it was asked has to go through the API with its token.
 *
 * `fetch` is a parameter, exactly as in the watchers, so tests never touch the network.
 */

const API = 'https://discord.com/api/v10'

/** Discord rejects a message over 2000 characters outright, so a long reply is trimmed. */
export const MAX_CONTENT = 2000

/** Trim to Discord's limit, marking the cut so a truncated answer never reads as a complete one. */
export function clampContent(text: string): string {
  if (text.length <= MAX_CONTENT) return text
  const notice = '\n… (truncated)'
  return text.slice(0, MAX_CONTENT - notice.length) + notice
}

/**
 * Post a message to a channel as the bot. Resolves `false` on any failure — a reply that cannot
 * be delivered must never take the daemon down.
 */
export async function postMessage(
  token: string,
  channelId: string,
  content: string,
  opts: { replyToId?: string; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const body: Record<string, unknown> = { content: clampContent(content) }
  // Thread the answer onto the message that asked, so a busy channel stays readable.
  if (opts.replyToId) {
    body['message_reference'] = { message_id: opts.replyToId, fail_if_not_exists: false }
  }
  try {
    const res = await fetchImpl(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}
