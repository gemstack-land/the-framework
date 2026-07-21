import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { cliRunner, isCliTimeout, CliTimeoutError } from './cli-exec.js'

const CWD = tmpdir()

/** Node itself is the stand-in binary: every platform running these tests has one. */
const NODE = process.execPath

/** A script that writes `mark` after 400ms, so a short budget kills it and a long one does not. */
const slowScript = (mark: string) => ['-e', `setTimeout(() => process.stdout.write('${mark}'), 400)`]

/** The rejection of `promise`, or `undefined` when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  )
}

test('a killed process rejects as a timeout, not as a generic failure (#997)', async () => {
  const run = cliRunner({ bin: NODE, timeoutMs: 50 })
  const err = await rejection(run(['-e', 'setTimeout(() => {}, 5000)'], CWD))
  assert.equal(isCliTimeout(err), true)
  assert.ok(err instanceof CliTimeoutError)
  assert.match((err as Error).message, /timed out after 50ms/)
})

test('a non-zero exit is not reported as a timeout (#997)', async () => {
  const run = cliRunner({ bin: NODE, timeoutMs: 10_000 })
  const err = await rejection(run(['-e', 'process.exit(3)'], CWD))
  assert.ok(err instanceof Error)
  assert.equal(isCliTimeout(err), false)
})

test('a timeout names the operation and the budget it outran (#997)', () => {
  const err = new CliTimeoutError('git', ['push', '--set-upstream', 'origin', 'branch'], 120_000)
  assert.equal(err.message, 'git push --set-upstream origin branch timed out after 120000ms')
  assert.equal(isCliTimeout(err), true)
})

test('isCliTimeout is false for a plain error and for a non-error (#997)', () => {
  assert.equal(isCliTimeout(new Error('fatal: no upstream')), false)
  assert.equal(isCliTimeout('nope'), false)
  assert.equal(isCliTimeout(undefined), false)
})

test('a per-args timeout gives the slow op room the short one does not (#997)', async () => {
  const seen: string[][] = []
  // The same 400ms of work under two budgets, chosen from the args the way git's is.
  const run = cliRunner({
    bin: NODE,
    timeoutMs: args => {
      seen.push(args)
      return args.includes('slow') ? 10_000 : 50
    },
  })

  assert.equal((await run([...slowScript('slow-done'), 'slow'], CWD)).trim(), 'slow-done')
  assert.equal(isCliTimeout(await rejection(run(slowScript('quick-done'), CWD))), true)
  assert.equal(seen.length, 2)
})
