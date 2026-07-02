import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AnyTool } from '@gemstack/ai-sdk'
import { FakeRunner } from './fake.js'
import { runnerTools } from './tools.js'

/** Invoke a tool's server handler directly. */
function call(tools: AnyTool[], name: string, input: unknown) {
  const tool = tools.find(t => t.definition.name === name)
  assert.ok(tool, `tool ${name} exists`)
  assert.ok(tool!.execute, `tool ${name} has a server handler`)
  return (tool!.execute as (i: unknown) => unknown)(input)
}

describe('runnerTools', () => {
  it('round-trips write_file → read_file through the session', async () => {
    const s = await new FakeRunner().boot()
    const tools = runnerTools(s)
    await call(tools, 'write_file', { path: 'pages/+Page.jsx', contents: 'PAGE' })
    assert.equal(s.snapshot()['pages/+Page.jsx'], 'PAGE')
    assert.equal(await call(tools, 'read_file', { path: 'pages/+Page.jsx' }), 'PAGE')
  })

  it('exec tool runs the command in the session', async () => {
    const runner = new FakeRunner({ onExec: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) })
    const s = await runner.boot()
    const r = (await call(runnerTools(s), 'exec', { command: 'pnpm build', cwd: 'app' })) as {
      exitCode: number
    }
    assert.equal(r.exitCode, 0)
    assert.deepEqual(s.execCalls, [{ command: 'pnpm build', opts: { cwd: 'app' } }])
  })

  it('includes preview only when the session supports it', async () => {
    const withPreview = runnerTools(await new FakeRunner().boot()).map(t => t.definition.name)
    assert.ok(withPreview.includes('preview'))
    const without = runnerTools(await new FakeRunner({ preview: false }).boot()).map(
      t => t.definition.name,
    )
    assert.ok(!without.includes('preview'))
  })

  it('includes start_server only when the session supports background processes', async () => {
    const withStart = runnerTools(await new FakeRunner().boot()).map(t => t.definition.name)
    assert.ok(withStart.includes('start_server'))
    const without = runnerTools(await new FakeRunner({ background: false }).boot()).map(t => t.definition.name)
    assert.ok(!without.includes('start_server'))
  })

  it('start_server rides the exec toggle (dropped from a read-only surface)', async () => {
    const names = runnerTools(await new FakeRunner().boot(), { exec: false }).map(t => t.definition.name)
    assert.ok(!names.includes('start_server'))
  })

  it('honors the write/exec toggles and the name prefix', async () => {
    const s = await new FakeRunner().boot()
    const names = runnerTools(s, { write: false, exec: false, prefix: 'sandbox' }).map(
      t => t.definition.name,
    )
    assert.deepEqual(names.sort(), ['sandbox_list_files', 'sandbox_preview', 'sandbox_read_file'])
  })
})
