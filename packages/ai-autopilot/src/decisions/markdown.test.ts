import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DecisionLedger } from './ledger.js'
import { parseDecisions, serializeDecisions } from './markdown.js'

describe('decisions markdown', () => {
  it('round-trips a ledger through serialize → parse', () => {
    const l = new DecisionLedger()
    l.record({ title: 'Use Redux', rationale: 'Too much boilerplate', tags: ['state'], date: '2026-07-02' })
    l.accept('Use Vike for SSR', 'Fits the stack')

    const reparsed = DecisionLedger.fromMarkdown(l.toMarkdown())
    assert.deepEqual(
      reparsed.all().map(d => ({ id: d.id, status: d.status, tags: d.tags, date: d.date })),
      l.all().map(d => ({ id: d.id, status: d.status, tags: d.tags, date: d.date })),
    )
    assert.equal(reparsed.get('use-redux')?.rationale, 'Too much boilerplate')
  })

  it('parses a hand-written file forgivingly (missing [status] → rejected)', () => {
    const md = [
      '# Decisions',
      '',
      '## Drop the GraphQL layer',
      '',
      'REST is enough for our surface.',
    ].join('\n')
    const [d] = parseDecisions(md)
    assert.equal(d?.status, 'rejected')
    assert.equal(d?.id, 'drop-the-graphql-layer')
    assert.equal(d?.rationale, 'REST is enough for our surface.')
  })

  it('skips a section with no rationale rather than throwing', () => {
    const md = '# Decisions\n\n## [accepted] Empty one\n- id: empty-one\n\n## [rejected] Real one\n\nbecause reasons'
    const ds = parseDecisions(md)
    assert.deepEqual(ds.map(d => d.id), ['real-one'])
  })

  it('serializes the header, status tag, and metadata', () => {
    const md = serializeDecisions([
      { id: 'x', title: 'X', status: 'accepted', rationale: 'y', tags: ['a', 'b'] },
    ])
    assert.match(md, /^# Decisions/)
    assert.match(md, /## \[accepted\] X/)
    assert.match(md, /- tags: a, b/)
  })
})
