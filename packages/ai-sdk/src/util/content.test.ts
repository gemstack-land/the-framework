import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { contentToString } from './content.js'
import type { ContentPart } from '../types.js'

describe('contentToString', () => {
  const mixed: ContentPart[] = [
    { type: 'text', text: 'Hello' },
    { type: 'image', data: 'x', mimeType: 'image/png' },
    { type: 'text', text: 'world' },
  ]

  it('passes a plain string through untouched', () => {
    assert.equal(contentToString('already text'), 'already text')
  })

  // The two separators are an intentional, settled difference (#573), not an oversight:
  // the provider default reconstructs the wire message with nothing injected, while
  // memory extraction separates parts so text does not jam across a dropped part.
  it('joins text parts with no separator by default, reconstructing the wire message', () => {
    assert.equal(contentToString(mixed), 'Helloworld')
  })

  it('separates parts with a given separator, which is what memory extraction needs (#573)', () => {
    // The image between the two text parts is dropped; the separator keeps the
    // remaining text from jamming into `Helloworld` for the extractor.
    assert.equal(contentToString(mixed, '\n'), 'Hello\nworld')
  })

  it('drops parts that carry no text', () => {
    assert.equal(contentToString([{ type: 'image', data: 'x', mimeType: 'image/png' }]), '')
    assert.equal(contentToString([{ type: 'document', data: 'x', mimeType: 'application/pdf' }]), '')
    assert.equal(contentToString([]), '')
  })

  it('keeps the parts in order', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'text', text: 'c' },
    ]
    assert.equal(contentToString(parts, '-'), 'a-b-c')
  })
})
