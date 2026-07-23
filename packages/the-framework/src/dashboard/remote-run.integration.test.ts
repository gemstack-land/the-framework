import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EventStream } from '@gemstack/ai-autopilot'
import { startDashboard } from './server.js'
import { relayRpc } from './remote-run.js'
import { createProjectRuntime, delay } from '../daemon-runtime.js'
import { dispatchRelayRpc } from '../dashboard-rpc/relay-dispatch.js'
import { forwardStream } from '../dashboard-rpc/stream-channel.js'
import { projectId } from '../registry.js'
import type { StartRunKind, StartRunOptions, StartRunResult } from './types.js'
import type { FrameworkEvent } from '../events.js'
import type { HandoffResult } from './run-handoff.js'

// The real two-daemon proof for "run on a connected device" (#1067). Two HTTP servers stand up on
// loopback: daemon A (the browser's local daemon, a real project runtime) relays a run to daemon B
// (the device, a dashboard whose Start is stubbed so no agent actually spawns). We assert the run
// is created on B, that A never touched its own busy guard, and that B's events stream back through
// A's relayed-run source in order. That is the whole path minus the final same-origin Telefunc hop on A,
// which relay.test.ts / server.test.ts cover on their own.

const TOKEN = 'zX2p8Q0hqk3m9tR7vN1cW4bY6sJ5aL0dFgHiKlMnOp'

async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-int-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'app.js'), '')
  return dir
}

/** Consume a stream until an event of `stopKind` arrives, or a timeout trips. */
async function collectUntil(stream: AsyncIterable<FrameworkEvent>, stopKind: string, timeoutMs = 4000): Promise<FrameworkEvent[]> {
  const got: FrameworkEvent[] = []
  const loop = (async () => {
    for await (const e of stream) {
      got.push(e)
      if ((e as { kind?: string }).kind === stopKind) return
    }
  })()
  await Promise.race([loop, delay(timeoutMs)])
  return got
}

test('a run submitted with options.remote is created on the other daemon and its events stream back (#1067)', async () => {
  // Daemon B: the device. Its Start is stubbed to record the call and emit a short event stream,
  // so the relay path is exercised without spawning a real agent.
  const bStarts: Array<{ prompt: string; kind: StartRunKind; options: StartRunOptions; projectId?: string }> = []
  const bStreams = new Map<string, EventStream<FrameworkEvent>>()
  const B_RUN = 'remote-run-1'
  const bStart = (prompt: string, kind: StartRunKind, options: StartRunOptions, pid?: string): StartRunResult => {
    bStarts.push({ prompt, kind, options, ...(pid ? { projectId: pid } : {}) })
    const stream = new EventStream<FrameworkEvent>()
    stream.push({ kind: 'log', message: 'hello from B' } as FrameworkEvent)
    stream.push({ kind: 'end', ok: true } as FrameworkEvent)
    stream.close()
    bStreams.set(B_RUN, stream)
    return { ok: true, runId: B_RUN }
  }
  const bTail = (runId: string, onEvent: (event: FrameworkEvent) => void): (() => void) => forwardStream(bStreams.get(runId), onEvent)
  const bundle = await fakeBundle()
  // B's own home checkout, whose id the device-side dispatch forces every relayed RPC onto (slice 2), so
  // a relayed read can only ever address B's own project. A plain temp dir (no repo, not registered), which
  // is enough to prove the /_relay/rpc path: an unregistered home resolves to no checkout, so onGitStatus
  // comes back null - proof the call reached B's own onGitStatus and returned over the endpoint.
  const cwdB = await mkdtemp(join(tmpdir(), 'relay-b-'))
  const homeIdB = projectId(resolve(cwdB))
  const bRpc = (fn: string, args: unknown[]): Promise<unknown> => dispatchRelayRpc(homeIdB, fn, args)
  const deviceB = await startDashboard({ port: 0, clientBundleDir: bundle, token: TOKEN, onStart: bStart, relay: { tailEvents: bTail, rpc: bRpc } })

  // Daemon A: the browser's own daemon, a real project runtime. Its onStart takes the remote branch.
  const cwdA = await mkdtemp(join(tmpdir(), 'relay-a-'))
  const runtimeA = createProjectRuntime({ cwd: cwdA, env: process.env })
  const homeIdA = projectId(resolve(cwdA))

  try {
    const result = await runtimeA.onStart('build the thing', 'build', { remote: { url: deviceB.url, token: TOKEN, label: 'my-laptop' } })

    // The run was created on B, and A returned B's own run id (not a locally allocated one).
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.runId, B_RUN)
    assert.equal(bStarts.length, 1)
    assert.equal(bStarts[0]!.prompt, 'build the thing')
    assert.equal(bStarts[0]!.options.remote, undefined) // stripped before forwarding, no onward relay
    assert.equal(bStarts[0]!.projectId, undefined) // slice 1: the device's own home checkout

    // A's own busy guard never fired: it allocated no worktree and spawned nothing.
    assert.equal(runtimeA.activeRunCount(homeIdA), 0)

    // The relayed run keeps a local list row on A (#1077), so a dashboard reload re-opens it instead of
    // losing it: a remote stub carrying B's run id, the device label, and the prompt, running until the
    // relay stream ends. Read before draining, while it is still live.
    const listed = runtimeA.remoteRuns.list(homeIdA)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.id, B_RUN)
    assert.equal(listed[0]!.target, 'remote')
    assert.equal(listed[0]!.status, 'running')
    assert.equal(listed[0]!.remoteLabel, 'my-laptop')
    assert.equal(listed[0]!.intent, 'build the thing')

    // The events stream back through A's relayed-run source, in order.
    const stream = runtimeA.remoteEventsSource(homeIdA, B_RUN)
    assert.ok(stream, 'A should expose a live stream for the relayed run')
    const events = await collectUntil(stream!, 'end')
    assert.deepEqual(
      events.map(e => (e as { message?: string; kind?: string }).message ?? (e as { kind?: string }).kind),
      ['hello from B', 'end'],
    )

    // B's stubbed start pushed `{kind:'end', ok:true}` and closed, so once A has drained the relayed
    // stream the list row settles to done (#1077): the state a reload would now read off the list.
    assert.equal(runtimeA.remoteRuns.list(homeIdA)[0]!.status, 'done')

    // Slice 2: a run-scoped read relays to B over /_relay/rpc and comes back. The caller's arg[0] is
    // A's local project id; B's dispatch drops it and reads against its own home, which has no repo
    // registered, so onGitStatus returns null - proof the call reached B's onGitStatus and returned.
    const gitStatus = await relayRpc({ url: deviceB.url, token: TOKEN }, 'onGitStatus', [homeIdA, B_RUN])
    assert.equal(gitStatus, null)

    // And a push runs ON the device: B_RUN is not a real session on B, so its sendPushBranch returns an
    // ok:false HandoffResult - proof the push ran on B's side (its checkout, its remote) and came back.
    const push = (await relayRpc({ url: deviceB.url, token: TOKEN }, 'sendPushBranch', [homeIdA, B_RUN])) as HandoffResult
    assert.equal(push.ok, false)
  } finally {
    await runtimeA.dispose()
    await deviceB.close()
    await rm(bundle, { recursive: true, force: true })
    await rm(cwdA, { recursive: true, force: true })
    await rm(cwdB, { recursive: true, force: true })
  }
})
