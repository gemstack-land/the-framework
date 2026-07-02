import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { launchAutopilot } from './launch.js'
import type { SupervisorEvent, SupervisorRun, PlannedSubtask, SubtaskResult } from '../types.js'

const sub: PlannedSubtask = { id: 'subtask-1', description: 'x' }
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
const okResult: SubtaskResult = { subtask: sub, text: 'ok', ok: true, usage: zeroUsage }

function fakeRun(): SupervisorRun {
  return { text: 'final', plan: [sub], results: [okResult], usage: zeroUsage, stoppedEarly: false }
}

describe('launchAutopilot', () => {
  it('runs detached: status goes running → done, events replay, result resolves', async () => {
    let emit!: (e: SupervisorEvent) => void
    let finish!: (run: SupervisorRun) => void
    const handle = launchAutopilot(onEvent => {
      emit = onEvent
      return new Promise<SupervisorRun>(resolve => {
        finish = resolve
      })
    })

    assert.equal(handle.status(), 'running')
    emit({ type: 'plan', task: 't', subtasks: [sub] })
    emit({ type: 'dispatch-result', result: okResult })
    assert.deepEqual(handle.events().map(e => e.type), ['plan', 'dispatch-result'])
    assert.deepEqual(handle.events(1).map(e => e.type), ['dispatch-result'])

    finish(fakeRun())
    const run = await handle.result()
    assert.equal(run.text, 'final')
    assert.equal(handle.status(), 'done')
  })

  it('exposes a live stream that ends when the run completes', async () => {
    let emit!: (e: SupervisorEvent) => void
    let finish!: (run: SupervisorRun) => void
    const handle = launchAutopilot(onEvent => {
      emit = onEvent
      return new Promise<SupervisorRun>(resolve => {
        finish = resolve
      })
    })

    const collected: string[] = []
    const consume = (async () => {
      for await (const e of handle.stream()) collected.push(e.type)
    })()

    await Promise.resolve()
    emit({ type: 'plan', task: 't', subtasks: [] })
    emit({ type: 'synthesize', results: [okResult] })
    finish(fakeRun())
    await consume
    assert.deepEqual(collected, ['plan', 'synthesize'])
  })

  it('marks error status and rejects result when the run throws', async () => {
    const handle = launchAutopilot(async () => {
      throw new Error('run failed')
    })
    await assert.rejects(() => handle.result(), /run failed/)
    assert.equal(handle.status(), 'error')
    // stream still ends cleanly after an error
    const seen: SupervisorEvent[] = []
    for await (const e of handle.stream()) seen.push(e)
    assert.deepEqual(seen, [])
  })

  it('carries a custom event and result type (bootstrap-shaped surface)', async () => {
    interface BootEvent {
      type: string
      message: string
    }
    interface BootResult {
      app: string
      blockers: string[]
    }

    let emit!: (e: BootEvent) => void
    let finish!: (r: BootResult) => void
    const handle = launchAutopilot<BootEvent, BootResult>(onEvent => {
      emit = onEvent
      return new Promise<BootResult>(resolve => {
        finish = resolve
      })
    })

    emit({ type: 'narrate', message: 'scaffolding' })
    assert.deepEqual(
      handle.events().map(e => e.message),
      ['scaffolding'],
    )
    finish({ app: 'shop', blockers: [] })
    const result = await handle.result()
    assert.equal(result.app, 'shop')
    assert.deepEqual(result.blockers, [])
  })

  it('honors an explicit id and generates unique ids otherwise', async () => {
    const a = launchAutopilot(async () => fakeRun(), { id: 'my-run' })
    const b = launchAutopilot(async () => fakeRun())
    const c = launchAutopilot(async () => fakeRun())
    assert.equal(a.id, 'my-run')
    assert.notEqual(b.id, c.id)
    await Promise.all([a.result(), b.result(), c.result()])
  })
})
