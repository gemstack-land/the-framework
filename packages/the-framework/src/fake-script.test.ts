import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoTurns } from './fake-script.js'
import { parseChoicesGate, parseMultiSelectGate } from './turn-gate.js'

test('demoTurns default: the plain scripted run, no await gate', () => {
  const turns = demoTurns(undefined)
  assert.equal(turns.length, 4) // build, checklist-blocker, improve, clean
  assert.ok(turns.every(t => parseChoicesGate(t.text) === undefined && parseMultiSelectGate(t.text) === undefined))
})

test('demoTurns choices: the build stops to ask a single-select the gate can parse (#337)', () => {
  const turns = demoTurns('choices')
  assert.equal(turns.length, 5) // + a resume turn after the ask
  const gate = parseChoicesGate(turns[0]!.text) // the build turn asks
  assert.ok(gate)
  assert.equal(gate.recommended, 'opt:0')
  assert.ok(gate.options.some(o => /Session cookies/.test(o.label)))
  // The turn right after the ask is the resume (no gate), so the run continues.
  assert.equal(parseChoicesGate(turns[1]!.text), undefined)
})

test('demoTurns multiselect: the build stops to ask a checklist with defaults (#339)', () => {
  const turns = demoTurns('multiselect')
  assert.equal(turns.length, 5)
  const gate = parseMultiSelectGate(turns[0]!.text)
  assert.ok(gate)
  const defaults = gate.options.filter(o => o.default).map(o => o.label)
  assert.deepEqual(defaults, ['auth model', 'orders schema'])
})

test('demoTurns ignores an unknown await mode and falls back to the default run', () => {
  assert.deepEqual(demoTurns('bogus'), demoTurns(undefined))
})
