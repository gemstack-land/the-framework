import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventStream, formatEvent, terminalSink } from './events.js'
import type { SupervisorEvent, PlannedSubtask, SubtaskResult } from '../types.js'

const sub: PlannedSubtask = { id: 'subtask-1', description: 'do a thing' }
const okResult: SubtaskResult = {
  subtask: sub,
  text: 'done',
  ok: true,
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
}

describe('EventStream history / tail replay', () => {
  it('buffers events and replays from an offset', () => {
    const s = new EventStream()
    s.push({ type: 'plan', task: 't', subtasks: [sub] })
    s.push({ type: 'dispatch-start', subtask: sub })
    assert.equal(s.length, 2)
    assert.equal(s.history().length, 2)
    assert.deepEqual(
      s.history(1).map(e => e.type),
      ['dispatch-start'],
    )
  })

  it('ignores pushes after close', () => {
    const s = new EventStream()
    s.close()
    s.push({ type: 'plan', task: 't', subtasks: [] })
    assert.equal(s.length, 0)
    assert.equal(s.isClosed, true)
  })
})

describe('EventStream async iteration', () => {
  it('replays buffered events then ends once closed', async () => {
    const s = new EventStream()
    s.push({ type: 'plan', task: 't', subtasks: [sub] })
    s.push({ type: 'synthesize', results: [okResult] })
    s.close()
    const seen: string[] = []
    for await (const e of s) seen.push(e.type)
    assert.deepEqual(seen, ['plan', 'synthesize'])
  })

  it('delivers events pushed after iteration starts, and to multiple iterators', async () => {
    const s = new EventStream()
    const collect = async () => {
      const out: string[] = []
      for await (const e of s) out.push(e.type)
      return out
    }
    const a = collect()
    const b = collect()
    // let the iterators reach their waiting state, then push + close
    await Promise.resolve()
    s.push({ type: 'plan', task: 't', subtasks: [] })
    s.push({ type: 'dispatch-result', result: okResult })
    s.close()
    assert.deepEqual(await a, ['plan', 'dispatch-result'])
    assert.deepEqual(await b, ['plan', 'dispatch-result'])
  })
})

describe('formatEvent', () => {
  const cases: Array<[SupervisorEvent, RegExp]> = [
    [{ type: 'plan', task: 'brief', subtasks: [sub] }, /plan: 1 subtask.*brief/],
    [{ type: 'plan-trimmed', kept: 2, dropped: 3, reason: 'maxSubtasks' }, /trimmed: kept 2, dropped 3/],
    [{ type: 'dispatch-start', subtask: sub }, /→ subtask-1: do a thing/],
    [{ type: 'dispatch-result', result: okResult }, /✓ subtask-1/],
    [
      { type: 'dispatch-result', result: { ...okResult, ok: false, text: '', error: new Error('boom') } },
      /✗ subtask-1 \(boom\)/,
    ],
    [{ type: 'budget-exceeded', spentTokens: 210, limitTokens: 200, skipped: 2 }, /budget exceeded: 210\/200.*2 skipped/],
    [{ type: 'synthesize', results: [okResult] }, /synthesize: 1 result/],
  ]
  for (const [event, re] of cases) {
    it(`renders a ${event.type} event`, () => {
      assert.match(formatEvent(event), re)
    })
  }
})

describe('EventStream generic element type', () => {
  interface BootEvent {
    type: 'narrate' | 'decision'
    message: string
  }

  it('carries a custom event type through push, history, and iteration', async () => {
    const s = new EventStream<BootEvent>()
    s.push({ type: 'narrate', message: 'picking the stack' })
    s.push({ type: 'decision', message: 'Vike + universal-orm' })
    s.close()

    assert.deepEqual(
      s.history().map(e => e.message),
      ['picking the stack', 'Vike + universal-orm'],
    )
    const seen: BootEvent[] = []
    for await (const e of s) seen.push(e)
    assert.deepEqual(seen.map(e => e.type), ['narrate', 'decision'])
  })
})

describe('terminalSink', () => {
  it('writes a formatted line per event to the provided writer', () => {
    const lines: string[] = []
    const sink = terminalSink({ write: l => lines.push(l) })
    sink({ type: 'plan', task: 't', subtasks: [sub] })
    sink({ type: 'dispatch-result', result: okResult })
    assert.equal(lines.length, 2)
    assert.match(lines[0]!, /plan: 1 subtask/)
    assert.match(lines[1]!, /✓ subtask-1/)
  })
})
