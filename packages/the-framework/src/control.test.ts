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

test('watchControl delivers live-chat messages and drops empty ones (#714)', async () => {
  const cwd = await tmpWorkspace()
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    await resetControl(cwd)
    await appendFile(
      controlPath(cwd),
      JSON.stringify({ kind: 'message', text: 'also add dark mode' }) + '\n' +
        JSON.stringify({ kind: 'message', text: '' }) + '\n' + // empty -> dropped
        JSON.stringify({ kind: 'message' }) + '\n', // missing text -> dropped
    )
    assert.ok(await until(() => seen.length === 1), `saw ${seen.length}`)
    assert.deepEqual(seen, [{ kind: 'message', text: 'also add dark mode' }])
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a message carries the surface it came through, and a forged one is dropped (#917)', async () => {
  const cwd = await tmpWorkspace()
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    await resetControl(cwd)
    await appendFile(
      controlPath(cwd),
      JSON.stringify({ kind: 'message', text: 'from discord', via: 'discord' }) + '\n' +
        // An entry written before #917 still parses, and is simply unattributed.
        JSON.stringify({ kind: 'message', text: 'older entry' }) + '\n' +
        // A via carrying the heading separator would forge a conversation heading (#897): dropped.
        JSON.stringify({ kind: 'message', text: 'forged', via: 'discord \u00b7 user \u00b7 x' }) + '\n' +
        JSON.stringify({ kind: 'message', text: 'newline', via: 'a\nb' }) + '\n' +
        JSON.stringify({ kind: 'message', text: 'not a string', via: 7 }) + '\n',
    )
    assert.ok(await until(() => seen.length === 2), `saw ${seen.length}`)
    assert.deepEqual(seen, [
      { kind: 'message', text: 'from discord', via: 'discord' },
      { kind: 'message', text: 'older entry' },
    ])
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a handoff entry needs both booleans, so a half-written line cannot disarm a session (#1102)', async () => {
  const dir = await tmpWorkspace()
  try {
    await resetControl(dir)
    const seen: ControlEntry[] = []
    const watcher = watchControl(dir, entry => seen.push(entry), 20)
    try {
      // Malformed first: a missing or non-boolean half must be dropped, not coerced. Getting this
      // wrong would silently stop a session publishing its work.
      await appendFile(controlPath(dir), JSON.stringify({ kind: 'handoff', push: true }) + '\n')
      await appendFile(controlPath(dir), JSON.stringify({ kind: 'handoff', push: 'yes', pr: false }) + '\n')
      await appendControl(dir, { kind: 'handoff', push: true, pr: false })
      assert.ok(await until(() => seen.length > 0), 'the well-formed entry never arrived')
      assert.deepEqual(seen, [{ kind: 'handoff', push: true, pr: false }])
    } finally {
      watcher.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
