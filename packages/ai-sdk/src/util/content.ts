import type { ContentPart } from '../types.js'

/**
 * Flatten a message's content to plain text: a string passes through, and a
 * {@link ContentPart} list contributes its text parts in order. Image and document
 * parts have no text and are dropped.
 *
 * `separator` is explicit because the call sites genuinely disagree: the providers
 * join with `''` (the parts are contiguous chunks of one message) while memory
 * extraction joins with `'\n'`. Whether that difference is intended is #572; this
 * only makes it visible at the call site rather than hidden in a fourth copy.
 */
export function contentToString(content: string | ContentPart[], separator = ''): string {
  if (typeof content === 'string') return content
  const text: string[] = []
  // `type === 'text'` narrows the union, so the part's `text` needs no cast or guard.
  for (const part of content) if (part.type === 'text') text.push(part.text)
  return text.join(separator)
}
