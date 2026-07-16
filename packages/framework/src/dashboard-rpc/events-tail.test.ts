import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FrameworkEvent } from '../events.js'
import { tailEvents } from './events-tail.js'

const line = (message: string): string => JSON.stringify({ kind: 'log', message } satisfies FrameworkEvent) + '\n'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'framework-events-tail-'))
}

test('tailEvents seeds with what is already logged, then follows appends', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('first'))
  const seen: string[] = []
  const stop = tailEvents<FrameworkEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['first'])
    await writeFile(path, line('first') + line('second'))
    await sleep(150)
    assert.deepEqual(seen, ['first', 'second'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents resets when a fresh run rewrites the log to the same length (#567)', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  // Both lines are the same byte length, so the shrink check alone cannot see this;
  // it is caught only by the same-length-rewrite detection. That is the whole point.
  assert.equal(Buffer.byteLength(line('old-run')), Buffer.byteLength(line('new-run')))
  await writeFile(path, line('old-run'))
  const seen: string[] = []
  const stop = tailEvents<FrameworkEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['old-run'])
    await sleep(20) // let mtime advance past the seeding read
    await writeFile(path, line('new-run'))
    await sleep(1400) // fs.watch, and the poll backstop behind it
    assert.deepEqual(seen, ['old-run', 'new-run'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents stops pulling once stopped, and skips malformed lines', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('kept') + 'not json at all\n')
  const seen: string[] = []
  const stop = tailEvents<FrameworkEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['kept']) // the malformed line never breaks the stream
    stop()
    await writeFile(path, line('kept') + line('after-stop'))
    await sleep(1200)
    assert.deepEqual(seen, ['kept']) // nothing arrives after the stop
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
