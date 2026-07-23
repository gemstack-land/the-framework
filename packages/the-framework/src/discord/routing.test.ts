import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decideAction, renderGate, resolvePick, HELP, type Gate, type RouteContext } from './routing.js'

const TARGET = { id: 'p1', name: 'gemstack' }

function gate(over: Partial<Gate> = {}): Gate {
  return {
    id: 'g1',
    title: 'How should I proceed?',
    options: [
      { id: 'proceed', label: 'Proceed' },
      { id: 'revise', label: 'Revise the plan' },
    ],
    ...over,
  }
}

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return { target: TARGET, ...over }
}

test('with nothing running, a message starts a session', () => {
  const action = decideAction('add a hello function', ctx())
  assert.equal(action.kind, 'start')
  assert.equal(action.kind === 'start' && action.projectId, 'p1')
  assert.equal(action.kind === 'start' && action.text, 'add a hello function')
})

test('with a run live, a message goes to that run (#714 control channel)', () => {
  const action = decideAction('also add tests', ctx({ live: { projectId: 'p1', runId: 'r1' } }))
  assert.equal(action.kind, 'message')
  assert.equal(action.kind === 'message' && action.runId, 'r1')
  assert.equal(action.kind === 'message' && action.text, 'also add tests')
})

test('a number answers a parked gate', () => {
  const action = decideAction('2', ctx({ live: { projectId: 'p1', runId: 'r1', gate: gate() } }))
  assert.equal(action.kind, 'choice')
  assert.equal(action.kind === 'choice' && action.gateId, 'g1')
  assert.equal(action.kind === 'choice' && action.pick, 'revise', 'the option id, not the number')
})

test('a gate can also be answered by label or id, case-insensitively', () => {
  for (const text of ['Revise the plan', 'revise the plan', 'REVISE']) {
    const action = decideAction(text, ctx({ live: { projectId: 'p1', runId: 'r1', gate: gate() } }))
    assert.equal(action.kind, 'choice', `should answer the gate: ${text}`)
    assert.equal(action.kind === 'choice' && action.pick, 'revise')
  }
})

test('a multi-select gate takes a comma list', () => {
  const multi = gate({ multi: true, options: [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ] })
  const action = decideAction('1,3', ctx({ live: { projectId: 'p1', runId: 'r1', gate: multi } }))
  assert.equal(action.kind, 'choice')
  assert.deepEqual(action.kind === 'choice' && action.pick, ['a', 'c'])
})

test('a message that is not an answer passes through to the run, never a guessed pick', () => {
  // Guessing an option on someone's behalf is worse than letting them say it again.
  const action = decideAction('wait, what does option 2 do?', ctx({ live: { projectId: 'p1', runId: 'r1', gate: gate() } }))
  assert.equal(action.kind, 'message')
})

test('an out-of-range number is not a pick', () => {
  assert.equal(resolvePick(gate(), '5'), undefined)
  assert.equal(resolvePick(gate(), '0'), undefined)
  const action = decideAction('5', ctx({ live: { projectId: 'p1', runId: 'r1', gate: gate() } }))
  assert.equal(action.kind, 'message', 'falls through rather than picking something')
})

test('a partly-valid multi list is rejected whole', () => {
  const multi = gate({ multi: true })
  assert.equal(resolvePick(multi, '1,9'), undefined, 'one bad index must not silently pick the other')
})

test('!stop stops a live run, and says so when there is nothing to stop', () => {
  const stop = decideAction('!stop', ctx({ live: { projectId: 'p1', runId: 'r1' } }))
  assert.equal(stop.kind, 'stop')
  assert.equal(stop.kind === 'stop' && stop.runId, 'r1')
  assert.equal(decideAction('!stop', ctx()).kind, 'reply')
})

test('!status reports the run and repeats a parked question', () => {
  const idle = decideAction('!status', ctx())
  assert.equal(idle.kind, 'reply')
  assert.match(idle.reply, /Nothing running/)

  const parked = decideAction('!status', ctx({ live: { projectId: 'p1', runId: 'r1', gate: gate() } }))
  assert.match(parked.reply, /How should I proceed\?/)
  assert.match(parked.reply, /^1\. Proceed$/m)
})

test('!help is a reply and nothing else', () => {
  const action = decideAction('!HELP', ctx({ live: { projectId: 'p1', runId: 'r1' } }))
  assert.equal(action.kind, 'reply')
  assert.equal(action.reply, HELP)
})

test('renderGate numbers the options from one', () => {
  const text = renderGate(gate())
  assert.match(text, /^1\. Proceed$/m)
  assert.match(text, /^2\. Revise the plan$/m)
})
