import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendControl,
  controlPath,
  resetControl,
  watchControl,
  type ControlEntry,
} from './control.js'

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'framework-control-'))
}

/** Poll until the predicate holds or the timeout passes. */
async function until(check: () => boolean, timeoutMs = 3000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 20))
  }
  return check()
}

test('appendControl + watchControl deliver entries in order', async () => {
  const cwd = await tmpWorkspace()
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    await appendControl(cwd, { kind: 'stop' })
    await appendControl(cwd, { kind: 'choice', id: 'plan-approval', pick: 'proceed', by: 'user' })
    await appendControl(cwd, { kind: 'choice', id: 'await-multiselect', pick: ['opt:0', 'opt:2'], by: 'autopilot' })

    assert.ok(await until(() => seen.length === 3), `saw ${seen.length} of 3 entries`)
    assert.deepEqual(seen[0], { kind: 'stop' })
    assert.deepEqual(seen[1], { kind: 'choice', id: 'plan-approval', pick: 'proceed', by: 'user' })
    assert.deepEqual(seen[2], { kind: 'choice', id: 'await-multiselect', pick: ['opt:0', 'opt:2'], by: 'autopilot' })
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('resetControl truncates so a previous run\'s picks never replay', async () => {
  const cwd = await tmpWorkspace()
  try {
    await appendControl(cwd, { kind: 'choice', id: 'plan-approval', pick: 'alt:0', by: 'user' })
    await resetControl(cwd)
    assert.equal(await readFile(controlPath(cwd), 'utf8'), '')

    // A watcher started after the reset (a fresh run) only sees new entries.
    const seen: ControlEntry[] = []
    const watcher = watchControl(cwd, e => seen.push(e), 20)
    try {
      await appendControl(cwd, { kind: 'stop' })
      assert.ok(await until(() => seen.length === 1))
      assert.deepEqual(seen, [{ kind: 'stop' }])
    } finally {
      watcher.close()
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('watchControl skips malformed and unknown lines', async () => {
  const cwd = await tmpWorkspace()
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    await resetControl(cwd)
    await appendFile(
      controlPath(cwd),
      'not json\n' +
        JSON.stringify({ kind: 'reboot' }) + '\n' +
        JSON.stringify({ kind: 'choice', id: '', pick: 'x' }) + '\n' + // empty id -> dropped
        JSON.stringify({ kind: 'choice', id: 'g', pick: 42 }) + '\n' + // bad pick -> dropped
        JSON.stringify({ kind: 'choice', id: 'g', pick: [], by: 'user' }) + '\n', // empty multi pick is legit
    )
    assert.ok(await until(() => seen.length === 1), `saw ${seen.length}`)
    assert.deepEqual(seen, [{ kind: 'choice', id: 'g', pick: [], by: 'user' }])
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})
