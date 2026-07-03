import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runQuickstart, TASK } from './autopilot.js'

describe('autopilot quickstart: the four layers compose end-to-end', () => {
  it('plans by persona, dispatches, acts in the sandbox, and surfaces progress', async () => {
    const lines: string[] = []
    const result = await runQuickstart(line => lines.push(line))

    // Supervisor: three subtasks, each routed to a stack persona, all succeeded.
    assert.equal(result.run.plan.length, 3)
    assert.deepEqual(
      result.run.plan.map(s => s.worker).sort(),
      ['data-modeler', 'ui-intent-designer', 'vike-page-builder'],
    )
    assert.ok(result.run.results.every(r => r.ok), 'every subtask succeeded')

    // Runner: each persona worker wrote its file into the sandbox via runnerTools.
    assert.ok('database/schema.ts' in result.files)
    assert.ok('pages/orders/+Page.jsx' in result.files)
    assert.match(result.files['database/schema.ts']!, /orders/)
    // the seed file is still there
    assert.ok('package.json' in result.files)

    // Runner: the post-build exec ran and a preview URL was exposed.
    assert.equal(result.build.exitCode, 0)
    assert.match(result.build.stdout, /built/)
    assert.match(result.previewUrl, /:5173$/)

    // Surfaces: the terminal sink printed a plan line and per-subtask lines;
    // the background handle captured the same events.
    assert.ok(lines.some(l => l.includes('plan:')), 'terminal printed the plan')
    assert.ok(lines.some(l => l.includes('✓')), 'terminal printed a completed subtask')
    assert.equal(result.events[0]!.type, 'plan')
    assert.equal(result.events.at(-1)!.type, 'synthesize')
  })

  it('exposes the task constant for the runnable demo', () => {
    assert.match(TASK, /Orders/)
  })
})
