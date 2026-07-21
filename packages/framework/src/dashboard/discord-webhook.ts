/**
 * The one Discord *webhook* transport (#627): a single POST of one message. The two
 * notification posters (activity, interventions) each carried their own copy of this fetch;
 * their line formatters rightly stay beside the types they switch on, but the transport is
 * not per-feed. Deliberately not in discord/rest.ts — that module is the bot-token API
 * (channels, replies), and a webhook needs no token and reaches one fixed channel.
 */
export async function postDiscordWebhook(webhook: string, content: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}
