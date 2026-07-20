import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { FrameworkEvent } from '../events.js'
import { openGate } from './live-run.js'

const choice = (id: string): FrameworkEvent =>
  ({
    kind: 'choice',
    id,
    title: 'Proceed?',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  }) as FrameworkEvent

const resolved = (id: string): FrameworkEvent => ({ kind: 'choice-resolved', id, picked: 'yes', by: 'user' }) as FrameworkEvent

test('openGate reads the options the run meta does not carry', () => {
  // `pendingChoice` has only the id and title, so the options come from the event log.
  const gate = openGate([choice('g1')], 'g1')
  assert.equal(gate?.title, 'Proceed?')
  assert.deepEqual(gate?.options, [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ])
})

test('an already-answered gate is not open', () => {
  // Otherwise a chat reply would answer a question the dashboard already closed.
  assert.equal(openGate([choice('g1'), resolved('g1')], 'g1'), undefined)
})

test('a gate re-asked after being resolved is open again', () => {
  assert.ok(openGate([choice('g1'), resolved('g1'), choice('g1')], 'g1'))
})

test('another gate id does not match', () => {
  assert.equal(openGate([choice('g1')], 'other'), undefined)
})

test('a multi-select gate is marked as one', () => {
  const multi = { ...choice('g1'), multi: true } as FrameworkEvent
  assert.equal(openGate([multi], 'g1')?.multi, true)
})
