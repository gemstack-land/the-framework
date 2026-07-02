import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DecisionLedger, createLedger } from './ledger.js'

describe('DecisionLedger — record / query', () => {
  it('records and reads back, with reject/accept shorthands', () => {
    const l = new DecisionLedger()
    l.reject('Use Redux for state', 'Too much boilerplate', ['state'])
    l.accept('Use Vike for SSR', 'Fits the stack')
    assert.equal(l.size, 2)
    assert.deepEqual(l.rejected().map(d => d.id), ['use-redux-for-state'])
    assert.equal(l.get('use-vike-for-ssr')?.status, 'accepted')
  })

  it('re-recording the same id replaces in place (reject → accept)', () => {
    const l = new DecisionLedger()
    l.reject('Use Postgres', 'too heavy for a prototype')
    l.accept('Use Postgres', 'the app grew, we need it')
    assert.equal(l.size, 1)
    assert.equal(l.get('use-postgres')?.status, 'accepted')
  })
})

describe('DecisionLedger — consult', () => {
  const ledger = createLedger()
  ledger.reject('Use Redux for state management', 'Too much boilerplate', ['state'])
  ledger.accept('Use Vike for SSR', 'Fits the stack', ['ssr'])

  it('surfaces a prior rejected idea for a re-pitch', () => {
    const matches = ledger.consult('add redux for managing state')
    assert.equal(matches[0]?.decision.id, 'use-redux-for-state-management')
    assert.ok(matches[0]!.score >= 0.5)
    assert.ok(matches[0]!.overlap.includes('redux'))
  })

  it('wasRejected is the fast re-pitch check', () => {
    assert.equal(ledger.wasRejected('lets use redux for state'), true)
    assert.equal(ledger.wasRejected('use vike for ssr'), false) // accepted, not rejected
    assert.equal(ledger.wasRejected('add a graphql layer'), false) // never decided
  })

  it('returns nothing below the threshold and honors status/limit filters', () => {
    assert.deepEqual(ledger.consult('a completely unrelated idea'), [])
    assert.deepEqual(
      ledger.consult('vike ssr rendering', { status: 'rejected' }),
      [],
    )
    assert.equal(ledger.consult('state', { limit: 0 }).length, 0)
  })

  it('ignores an empty idea', () => {
    assert.deepEqual(ledger.consult('   '), [])
  })
})
