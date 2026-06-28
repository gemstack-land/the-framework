/**
 * Deterministic, network-free "AI" summarizer (the baseline stub).
 *
 * Returns the first sentence of the body, trimmed to <= 140 chars. No external
 * SDK, no API key - the GemStack app reaches the same default via @gemstack/ai-sdk's
 * stub model, so both baselines stay reproducible.
 */
export function summarize(body: string): string {
  const text = body.trim();
  if (!text) return '';

  // First sentence: up to and including the first ., !, or ? (else the whole body).
  const match = text.match(/^[\s\S]*?[.!?]/);
  const firstSentence = (match ? match[0] : text).trim();

  return firstSentence.length > 140 ? firstSentence.slice(0, 140) : firstSentence;
}
