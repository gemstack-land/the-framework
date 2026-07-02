import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AnyTool } from '@gemstack/ai-sdk'
import { DecisionLedger } from './ledger.js'
import { decisionTools, decisionBriefing } from './tools.js'

/** Invoke a tool's server handler directly. */
function call(tools: AnyTool[], name: string, input: unknown) {
  const tool = tools.find(t => t.definition.name === name)
  assert.ok(tool, `tool ${name} exists`)
  return (tool!.execute as (i: unknown) => unknown)(input)
}

describe('decisionTools', () => {
  it('consult_decisions surfaces a prior rejected idea', async () => {
    const ledger = new DecisionLedger()
    ledger.reject('Use Redux for state', 'Too much boilerplate', ['state'])
    const r = (await call(decisionTools(ledger), 'consult_decisions', {
      idea: 'add redux for state',
    })) as { matches: Array<{ status: string; title: string }> }
    assert.equal(r.matches[0]?.status, 'rejected')
    assert.match(r.matches[0]!.title, /Redux/)
  })

  it('record_decision appends and fires onRecord for persistence', async () => {
    const ledger = new DecisionLedger()
    let persisted = 0
    const tools = decisionTools(ledger, { onRecord: () => { persisted++ } })
    const r = (await call(tools, 'record_decision', {
      title: 'Drop GraphQL',
      status: 'rejected',
      rationale: 'REST is enough',
    })) as { ok: boolean; id: string }
    assert.equal(r.id, 'drop-graphql')
    assert.equal(ledger.wasRejected('use graphql'), true)
    assert.equal(persisted, 1)
  })

  it('honors the record toggle and name prefix', () => {
    const names = decisionTools(new DecisionLedger(), { record: false, prefix: 'decisions' }).map(
      t => t.definition.name,
    )
    assert.deepEqual(names, ['decisions_consult_decisions'])
  })
})

describe('decisionBriefing', () => {
  it('renders rejected ideas and is empty when there are none', () => {
    assert.equal(decisionBriefing(new DecisionLedger()), '')
    const ledger = new DecisionLedger()
    ledger.reject('Use Redux', 'boilerplate')
    ledger.accept('Use Vike', 'good')
    const brief = decisionBriefing(ledger)
    assert.match(brief, /Use Redux \(rejected: boilerplate\)/)
    assert.doesNotMatch(brief, /Use Vike/) // accepted choices are not in the "do not propose" list
  })
})
