import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ConversationMessage } from '../conversations.js'
import { startDiscordReplyMirror } from './reply-mirror.js'

const turn = (role: 'user' | 'agent', text: string): ConversationMessage => ({
  at: '2026-07-21T00:00:00.000Z',
  role,
  via: 'discord',
  text,
})

/** A mirror over an in-memory transcript, recording everything posted. */
function harness(seed: ConversationMessage[] = [], enabled?: () => Promise<boolean>) {
  let transcript = seed
  const posted: Array<{ channelId: string; text: string }> = []
  let deliver = true
  const logs: string[] = []
  const mirror = startDiscordReplyMirror({
    readConversation: async () => transcript,
    post: async (channelId, text) => {
      if (deliver) posted.push({ channelId, text })
      return deliver
    },
    ...(enabled ? { enabled } : {}),
    intervalMs: 1_000_000, // drive by hand
    onLog: m => logs.push(m),
  })
  return {
    mirror,
    posted,
    logs,
    say: (...messages: ConversationMessage[]) => (transcript = [...transcript, ...messages]),
    set deliver(v: boolean) {
      deliver = v
    },
  }
}

test('an agent reply is posted to the channel that asked (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('user', 'add dark mode'), turn('agent', 'Done, I changed two files.'))
    await h.mirror.poll()
    assert.deepEqual(h.posted, [{ channelId: 'chan-1', text: 'Done, I changed two files.' }])
  } finally {
    h.mirror.stop()
  }
})

test('the user own message is not echoed back at them (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('user', 'add dark mode'))
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'only the agent side is mirrored')
  } finally {
    h.mirror.stop()
  }
})

test('binding adopts the existing transcript instead of replaying it (#932)', async () => {
  // The whole backlog problem: binding to a run that has been going for an hour must not dump
  // an hour of answers into the channel.
  const h = harness([turn('user', 'earlier'), turn('agent', 'an old answer'), turn('agent', 'another old one')])
  try {
    await h.mirror.bind('run-1', 'chan-1')
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'nothing said before the bind is posted')

    h.say(turn('agent', 'a new answer'))
    await h.mirror.poll()
    assert.deepEqual(h.posted, [{ channelId: 'chan-1', text: 'a new answer' }])
  } finally {
    h.mirror.stop()
  }
})

test('a reply that lands before the first poll is still posted (#932)', async () => {
  // The race the bind-time baseline exists to close: a fast agent answers between the bind and the
  // first tick. Baselining on first poll instead would swallow exactly this reply.
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('agent', 'answered immediately'))
    await h.mirror.poll()
    assert.deepEqual(h.posted, [{ channelId: 'chan-1', text: 'answered immediately' }])
  } finally {
    h.mirror.stop()
  }
})

test('each answer is posted once, however often it polls (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('agent', 'one'))
    await h.mirror.poll()
    await h.mirror.poll()
    await h.mirror.poll()
    assert.deepEqual(h.posted.map(p => p.text), ['one'])
  } finally {
    h.mirror.stop()
  }
})

test('while the bot is off the cursor still advances, so turning it on starts from now (#932)', async () => {
  let on = false
  const h = harness([], async () => on)
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('agent', 'said while off'))
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'nothing is posted while off')

    on = true
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'and the backlog is not flushed when it comes back on')

    h.say(turn('agent', 'said while on'))
    await h.mirror.poll()
    assert.deepEqual(h.posted.map(p => p.text), ['said while on'])
  } finally {
    h.mirror.stop()
  }
})

test('an unbound run is not mirrored (#932)', async () => {
  const h = harness()
  try {
    h.say(turn('agent', 'nobody asked for this'))
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'a dashboard-started run posts into no channel')
    assert.equal(h.mirror.isBound('run-1'), false)
  } finally {
    h.mirror.stop()
  }
})

test('unbind stops mirroring a finished run (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    assert.equal(h.mirror.isBound('run-1'), true)
    h.mirror.unbind('run-1')
    assert.equal(h.mirror.isBound('run-1'), false)

    h.say(turn('agent', 'after the end'))
    await h.mirror.poll()
    assert.equal(h.posted.length, 0)
  } finally {
    h.mirror.stop()
  }
})

test('a blank answer is not posted (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.say(turn('agent', '   \n  '))
    await h.mirror.poll()
    assert.equal(h.posted.length, 0)
  } finally {
    h.mirror.stop()
  }
})

test('a failed delivery is logged and never retried into a duplicate (#932)', async () => {
  const h = harness()
  try {
    await h.mirror.bind('run-1', 'chan-1')
    h.deliver = false
    h.say(turn('agent', 'undeliverable'))
    await h.mirror.poll()
    assert.equal(h.logs.length, 1, h.logs.join(','))

    h.deliver = true
    await h.mirror.poll()
    assert.equal(h.posted.length, 0, 'the cursor moved on rather than re-posting later')
  } finally {
    h.mirror.stop()
  }
})

test('an unreadable conversation costs one poll, not the mirror (#932)', async () => {
  const mirror = startDiscordReplyMirror({
    readConversation: async () => {
      throw new Error('unreadable')
    },
    post: async () => true,
    intervalMs: 1_000_000,
  })
  try {
    await mirror.bind('run-1', 'chan-1') // must not reject
    await mirror.poll() // must not reject
  } finally {
    mirror.stop()
  }
})

test('stop clears the bindings so nothing is mirrored afterwards (#932)', async () => {
  const h = harness()
  await h.mirror.bind('run-1', 'chan-1')
  h.mirror.stop()
  assert.equal(h.mirror.isBound('run-1'), false)
  h.say(turn('agent', 'after stop'))
  await h.mirror.poll()
  assert.equal(h.posted.length, 0)
})

test('two runs post to their own channels (#932)', async () => {
  let a: ConversationMessage[] = []
  let b: ConversationMessage[] = []
  const posted: Array<{ channelId: string; text: string }> = []
  const mirror = startDiscordReplyMirror({
    readConversation: async runId => (runId === 'run-a' ? a : b),
    post: async (channelId, text) => {
      posted.push({ channelId, text })
      return true
    },
    intervalMs: 1_000_000,
  })
  try {
    await mirror.bind('run-a', 'chan-a')
    await mirror.bind('run-b', 'chan-b')
    a = [turn('agent', 'from a')]
    b = [turn('agent', 'from b')]
    await mirror.poll()
    assert.deepEqual(posted.sort((x, y) => x.channelId.localeCompare(y.channelId)), [
      { channelId: 'chan-a', text: 'from a' },
      { channelId: 'chan-b', text: 'from b' },
    ])
  } finally {
    mirror.stop()
  }
})
