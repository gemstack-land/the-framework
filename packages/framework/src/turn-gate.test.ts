import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseChoicesGate } from './turn-gate.js'

const block = (json: string): string => 'Here are the options.\n```await-choices\n' + json + '\n```'

test('parseChoicesGate returns undefined when the agent did not stop to ask (#337)', () => {
  assert.equal(parseChoicesGate('Built the whole app. Done.'), undefined)
})

test('parseChoicesGate parses a well-formed await-choices block (#337)', () => {
  const gate = parseChoicesGate(
    block('{ "title": "Which auth?", "options": [{ "id": "sessions", "label": "Sessions" }, { "id": "jwt", "label": "JWT", "detail": "stateless" }], "recommended": "sessions" }'),
  )
  assert.ok(gate)
  assert.equal(gate.title, 'Which auth?')
  assert.equal(gate.recommended, 'sessions')
  assert.deepEqual(gate.options, [
    { id: 'sessions', label: 'Sessions' },
    { id: 'jwt', label: 'JWT', detail: 'stateless' },
  ])
})

test('parseChoicesGate synthesizes ids and defaults a blank title (#337)', () => {
  const gate = parseChoicesGate(block('{ "options": [{ "label": "A" }, { "label": "B" }] }'))
  assert.ok(gate)
  assert.equal(gate.title, 'Which option?')
  assert.deepEqual(gate.options.map(o => o.id), ['opt:0', 'opt:1'])
  assert.equal(gate.recommended, undefined)
})

test('parseChoicesGate maps a recommended label to its option id (#337)', () => {
  const gate = parseChoicesGate(block('{ "title": "Pick", "options": [{ "label": "First" }, { "label": "Second" }], "recommended": "Second" }'))
  assert.ok(gate)
  assert.equal(gate.recommended, 'opt:1')
})

test('parseChoicesGate takes the last block when a turn has more than one (#337)', () => {
  const text = block('{ "options": [{ "label": "old" }] }') + '\n' + block('{ "title": "final", "options": [{ "label": "new" }] }')
  const gate = parseChoicesGate(text)
  assert.ok(gate)
  assert.equal(gate.title, 'final')
  assert.deepEqual(gate.options.map(o => o.label), ['new'])
})

test('parseChoicesGate ignores a malformed or empty block rather than throwing (#337)', () => {
  assert.equal(parseChoicesGate(block('{ not json')), undefined)
  assert.equal(parseChoicesGate(block('{ "options": [] }')), undefined)
  assert.equal(parseChoicesGate(block('{ "options": [{ "detail": "no label" }] }')), undefined)
  assert.equal(parseChoicesGate(block('{ "title": "x" }')), undefined) // no options array
})
