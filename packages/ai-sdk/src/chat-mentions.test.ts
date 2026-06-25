import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseMentions, buildMentionRoutingRule, MENTION_REGEX } from './chat-mentions.js'

const KNOWN = ['seo', 'writer', 'seo-assistant']

describe('parseMentions', () => {
  it('extracts a known mention and strips it from the message', () => {
    const r = parseMentions('@seo please audit this page', KNOWN)
    assert.deepStrictEqual(r.slugs, ['seo'])
    assert.equal(r.cleaned, 'please audit this page')
  })

  it('leaves an unknown mention as plain text', () => {
    const r = parseMentions('@nope do something', KNOWN)
    assert.deepStrictEqual(r.slugs, [])
    assert.equal(r.cleaned, '@nope do something')
  })

  it('dedupes and preserves first-seen order across multiple mentions', () => {
    const r = parseMentions('@writer and @seo and @writer again', KNOWN)
    assert.deepStrictEqual(r.slugs, ['writer', 'seo'])
    assert.equal(r.cleaned, 'and and again')
  })

  it('is case-insensitive and lower-cases the result', () => {
    const r = parseMentions('@SEO @Writer', KNOWN)
    assert.deepStrictEqual(r.slugs, ['seo', 'writer'])
  })

  it('accepts a Set of known slugs', () => {
    const r = parseMentions('@seo go', new Set(KNOWN))
    assert.deepStrictEqual(r.slugs, ['seo'])
  })

  it('does not treat an email address as a mention', () => {
    const r = parseMentions('mail me at user@seo.com', KNOWN)
    assert.deepStrictEqual(r.slugs, [])
    assert.equal(r.cleaned, 'mail me at user@seo.com')
  })

  it('does not eat trailing punctuation after a slug', () => {
    const r = parseMentions('ping @seo-assistant.', KNOWN)
    assert.deepStrictEqual(r.slugs, ['seo-assistant'])
    assert.equal(r.cleaned, 'ping .')
  })

  it('handles a mention at the start of the string', () => {
    const r = parseMentions('@seo', KNOWN)
    assert.deepStrictEqual(r.slugs, ['seo'])
    assert.equal(r.cleaned, '')
  })

  it('does not leak regex lastIndex across calls (shared MENTION_REGEX)', () => {
    // Two calls in a row must behave identically - would fail if a global
    // regex's lastIndex carried over.
    const a = parseMentions('@seo x', KNOWN)
    const b = parseMentions('@seo x', KNOWN)
    assert.deepStrictEqual(a, b)
    assert.equal(MENTION_REGEX.lastIndex, 0)
  })
})

describe('buildMentionRoutingRule', () => {
  it('returns null for no mentions', () => {
    assert.equal(buildMentionRoutingRule([]), null)
  })

  it('renders a single-mention rule with the default tool name', () => {
    const rule = buildMentionRoutingRule(['seo'])!
    assert.match(rule, /HARD RULE/)
    assert.match(rule, /run_agent\(\{ agentSlug: "seo" \}\)/)
  })

  it('renders a multi-mention ordered rule', () => {
    const rule = buildMentionRoutingRule(['seo', 'writer'])!
    assert.match(rule, /in order: `seo`, `writer`/)
    assert.match(rule, /for each one in turn/)
  })

  it('honors a custom tool name and arg key', () => {
    const rule = buildMentionRoutingRule(['seo'], { toolName: 'dispatch', argKey: 'slug' })!
    assert.match(rule, /dispatch\(\{ slug: "seo" \}\)/)
  })
})
