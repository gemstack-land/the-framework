import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseOverview, serializeOverview } from './markdown.js'
import type { CodeOverview } from './types.js'

describe('CODE-OVERVIEW.md round-trip', () => {
  const overview: CodeOverview = {
    summary: 'A server-rendered bookstore on Vike + universal-orm.',
    sections: [
      { title: 'Structure', body: '- `pages/` — Vike routes\n- `database/` — schema + migrations' },
      { title: 'Conventions', body: 'Data access goes through the model builder.' },
    ],
  }

  it('serializes to a titled markdown doc', () => {
    const md = serializeOverview(overview)
    assert.match(md, /^# Code Overview\n/)
    assert.match(md, /## Structure/)
    assert.match(md, /## Conventions/)
  })

  it('parses back to the same data (lossless)', () => {
    assert.deepEqual(parseOverview(serializeOverview(overview)), overview)
  })

  it('treats text before the first ## as the summary and tolerates a missing title', () => {
    const parsed = parseOverview('Just a repo.\n\n## Structure\nflat.')
    assert.equal(parsed.summary, 'Just a repo.')
    assert.deepEqual(parsed.sections, [{ title: 'Structure', body: 'flat.' }])
  })

  it('yields an empty overview for an empty string', () => {
    assert.deepEqual(parseOverview(''), { summary: '', sections: [] })
  })
})
