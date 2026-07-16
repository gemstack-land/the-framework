import type { ContentPart } from '../types.js'

/**
 * Flatten a message's content to plain text: a string passes through, and a
 * {@link ContentPart} list contributes its text parts in order. Image and document
 * parts have no text and are dropped.
 *
 * `separator` is explicit because the two call sites genuinely differ, and the
 * difference is intentional (#573):
 * - providers join with `''` (the default): they rebuild the wire message, so the
 *   text is reconstructed as authored, with nothing injected between parts.
 * - memory extraction joins with `'\n'`: it feeds the flattened text to an extractor,
 *   and a separator keeps parts from jamming together where a non-text part (e.g. a
 *   dropped image) sat between them, so `['Hello', 'world']` reads as two lines rather
 *   than `Helloworld`.
 */
export function contentToString(content: string | ContentPart[], separator = ''): string {
  if (typeof content === 'string') return content
  const text: string[] = []
  // `type === 'text'` narrows the union, so the part's `text` needs no cast or guard.
  for (const part of content) if (part.type === 'text') text.push(part.text)
  return text.join(separator)
}
