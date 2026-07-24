import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { loopStatus, sessionInfo, deployPlan, runProgress, handoffState } from './run-view.js'
import type { FrameworkEvent } from './events.js'

test('runProgress starts building with no name and flips to ready on setReadyForMerge (#326)', () => {
  assert.deepEqual(runProgress([]), { readyForMerge: false })
  const building: FrameworkEvent[] = [{ kind: 'session-name', name: 'add-comments' }]
  assert.deepEqual(runProgress(building), { sessionName: 'add-comments', readyForMerge: false })
  const ready: FrameworkEvent[] = [...building, { kind: 'ready-for-merge' }]
  assert.deepEqual(runProgress(ready), { sessionName: 'add-comments', readyForMerge: true })
})

test('runProgress takes the latest session name when the agent renames it (#326)', () => {
  const events: FrameworkEvent[] = [
    { kind: 'session-name', name: 'first-guess' },
    { kind: 'session-name', name: 'better-name' },
  ]
  assert.equal(runProgress(events).sessionName, 'better-name')
})

test('loopStatus tracks the latest checklist verdict and closes on done (#431)', () => {
  const boot = (event: Record<string, unknown>): FrameworkEvent => ({ kind: 'bootstrap', event: event as never })
  assert.equal(loopStatus([{ kind: 'log', message: 'x' }]), null) // no checklist yet

  const failing = loopStatus([boot({ type: 'checklist', pass: 1, blockers: ['no tests'], passing: false })])
  assert.deepEqual(failing, { pass: 1, passing: false, blockers: ['no tests'], productionGrade: false, finished: false })

  const done = loopStatus([
    boot({ type: 'checklist', pass: 1, blockers: ['no tests'], passing: false }),
    boot({ type: 'done', result: { passes: 2, blockers: [], productionGrade: true } }),
  ])
  assert.deepEqual(done, { pass: 2, passing: true, blockers: [], productionGrade: true, finished: true })
})

test('sessionInfo merges the opening session with the latest session-update link (#431)', () => {
  const events: FrameworkEvent[] = [
    { kind: 'session', driver: 'claude', workspace: '/repo', fake: false },
    { kind: 'session-update', sessionId: 'sess-1', sessionLink: 'https://claude.ai/code/sess-1' },
  ]
  const info = sessionInfo(events)
  assert.equal(info?.driver, 'claude')
  assert.equal(info?.sessionId, 'sess-1')
  assert.equal(info?.sessionLink, 'https://claude.ai/code/sess-1')
  assert.equal(sessionInfo([{ kind: 'log', message: 'x' }]), null)
})

test('deployPlan returns the chosen deploy target from the deploy event; latest wins (#433)', () => {
  const boot = (event: Record<string, unknown>): FrameworkEvent => ({ kind: 'bootstrap', event: event as never })
  assert.equal(deployPlan([{ kind: 'log', message: 'x' }]), null) // no deploy yet
  const plan = deployPlan([
    boot({ type: 'deploy', plan: { render: 'ssg', target: 'github-pages', reason: 'static' }, result: { deployed: false } }),
    boot({ type: 'deploy', plan: { render: 'ssr', target: 'dokploy', reason: 'per-request data' }, result: { deployed: true } }),
  ])
  assert.deepEqual(plan, { render: 'ssr', target: 'dokploy', reason: 'per-request data' })
})

test('a run with no handoff events reads as armed, matching what it will do (#1102)', () => {
  // An older run emits no `handoff-armed`. Reading that as disarmed would show two unticked boxes
  // for a session that is in fact going to push and open a PR.
  assert.deepEqual(handoffState([]), { push: true, pr: true })
})

test('handoffState takes the latest arming, so unticking a box sticks (#1102)', () => {
  const events: FrameworkEvent[] = [
    { kind: 'handoff-armed', push: true, pr: true },
    { kind: 'handoff-armed', push: true, pr: false },
  ]
  assert.deepEqual(handoffState(events), { push: true, pr: false })
})

test('handoffState carries the outcome once the handoff has run (#1102)', () => {
  const done: FrameworkEvent[] = [
    { kind: 'handoff-armed', push: true, pr: true },
    { kind: 'handoff', outcome: 'done', pushed: true, url: 'https://github.com/o/r/pull/3' },
  ]
  assert.deepEqual(handoffState(done).result, { outcome: 'done', url: 'https://github.com/o/r/pull/3' })

  // A failure has to survive into the projection: it is what the bar shows beside the retry button.
  const failed: FrameworkEvent[] = [{ kind: 'handoff', outcome: 'failed', step: 'push', error: 'fatal: no write access' }]
  assert.deepEqual(handoffState(failed).result, { outcome: 'failed', error: 'fatal: no write access' })

  const skipped: FrameworkEvent[] = [{ kind: 'handoff', outcome: 'skipped', reason: 'no-remote' }]
  assert.deepEqual(handoffState(skipped).result, { outcome: 'skipped', reason: 'no-remote' })
})
