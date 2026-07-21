import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, setConversationStore } from './agent.js'
import { AiFake } from './fake.js'
import { MemoryConversationStore } from './conversation.js'
import { ConversationOwnershipError, resolveAutoPersistSpec } from './conversation-persistence.js'
import type { AgentResponse, AiMessage, ConversationalSpec, ConversationStore } from './types.js'

// Test agents with declarative conversational() opts-in. Each class stores
// the user it was created with on the instance so tests can drive different
// scenarios from the outside without rebuilding the fake.
class ChatAgent extends Agent {
  static lastUser:    string | undefined
  static lastSpec:    Partial<ConversationalSpec> | undefined
  static asyncDelay = 0
  instructions() { return 'You are a chat agent.' }
  conversational(): false | ConversationalSpec | Promise<false | ConversationalSpec> {
    const spec = ChatAgent.lastUser
      ? { user: ChatAgent.lastUser, ...(ChatAgent.lastSpec ?? {}) }
      : false
    if (ChatAgent.asyncDelay > 0) {
      return new Promise(res => setTimeout(() => res(spec), ChatAgent.asyncDelay))
    }
    return spec
  }
}

class SupportAgent extends Agent {
  static user: string | undefined
  instructions() { return 'You are a support agent.' }
  conversational() { return SupportAgent.user ? { user: SupportAgent.user } : false }
}

class StatelessAgent extends Agent {
  instructions() { return 'I do not remember.' }
  // No conversational() override — default returns false.
}

// ─── resolveAutoPersistSpec ───────────────────────────────

describe('resolveAutoPersistSpec', () => {
  it('returns null when both per-call and class agree on opt-out', async () => {
    assert.equal(await resolveAutoPersistSpec(() => false, undefined), null)
  })

  it('per-call false wins over class declaration', async () => {
    assert.equal(await resolveAutoPersistSpec(() => ({ user: 'u' }), false), null)
  })

  it('per-call object replaces class declaration', async () => {
    const r = await resolveAutoPersistSpec(() => ({ user: 'class' }), { user: 'percall' })
    assert.deepStrictEqual(r, { user: 'percall' })
  })

  it('falls back to class declaration when per-call omitted', async () => {
    const r = await resolveAutoPersistSpec(() => ({ user: 'class' }), undefined)
    assert.deepStrictEqual(r, { user: 'class' })
  })

  it('awaits async class declaration', async () => {
    const r = await resolveAutoPersistSpec(() => Promise.resolve({ user: 'async-u' }), undefined)
    assert.deepStrictEqual(r, { user: 'async-u' })
  })

  it('rejects spec lacking both user and id', async () => {
    const r = await resolveAutoPersistSpec(() => ({ user: '' }) as ConversationalSpec, undefined)
    assert.equal(r, null)
  })
})

// ─── Auto-persist on plain Agent.prompt() ─────────────────

describe('Auto-persist via conversational()', () => {
  let fake: AiFake

  beforeEach(() => {
    fake = AiFake.fake()
    ChatAgent.lastUser    = undefined
    ChatAgent.lastSpec    = undefined
    ChatAgent.asyncDelay  = 0
    SupportAgent.user     = undefined
    setConversationStore(undefined as unknown as never)
  })

  it('stateless default: prompt() does NOT touch the store', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('hi')

    const r = await new StatelessAgent().prompt('hello')
    assert.equal(r.conversationId, undefined, 'no conversationId on stateless agent')
    assert.deepStrictEqual(await store.list(), [])
  })

  it('first call creates a thread and stamps response.conversationId', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('hi')

    ChatAgent.lastUser = 'u-1'
    const r = await new ChatAgent().prompt('first')
    assert.ok(r.conversationId, 'conversationId set on response')

    const messages = await store.load(r.conversationId!)
    assert.deepStrictEqual(messages.map(m => [m.role, m.content]), [
      ['user', 'first'],
      ['assistant', 'hi'],
    ])
  })

  it('second call for the same user + agent class resumes the most-recent thread', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('one')

    ChatAgent.lastUser = 'u-1'
    const r1 = await new ChatAgent().prompt('hello')
    fake.respondWith('two')
    const r2 = await new ChatAgent().prompt('still you?')

    assert.equal(r1.conversationId, r2.conversationId, 'second call resumes the same thread')
    const messages = await store.load(r1.conversationId!)
    assert.deepStrictEqual(messages.map(m => m.content), ['hello', 'one', 'still you?', 'two'])
  })

  it('separates threads for different agent classes for the same user', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('chat-reply')

    ChatAgent.lastUser = 'u-1'
    const chatR = await new ChatAgent().prompt('hi')

    fake.respondWith('support-reply')
    SupportAgent.user = 'u-1'
    const supportR = await new SupportAgent().prompt('help')

    assert.notEqual(chatR.conversationId, supportR.conversationId, 'distinct threads per agent class')
    const list = await store.list('u-1')
    assert.equal(list.length, 2)
  })

  it('async conversational() return is awaited', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('async-ok')

    ChatAgent.lastUser   = 'u-async'
    ChatAgent.asyncDelay = 5
    const r = await new ChatAgent().prompt('hi')
    assert.ok(r.conversationId)
  })

  it('per-call { conversation: false } skips persistence even when class opts in', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('ephemeral')

    ChatAgent.lastUser = 'u-1'
    const r = await new ChatAgent().prompt('one-off', { conversation: false })
    assert.equal(r.conversationId, undefined)
    assert.deepStrictEqual(await store.list(), [])
  })

  it('per-call conversation override replaces class declaration', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('ok')

    ChatAgent.lastUser = 'u-class'
    const r = await new ChatAgent().prompt('hi', { conversation: { user: 'u-percall' } })

    const list = await store.list('u-percall')
    assert.equal(list.length, 1)
    assert.equal(list[0]!.id, r.conversationId)
    // Original user got nothing
    assert.deepStrictEqual(await store.list('u-class'), [])
  })

  it('historyLimit caps the loaded history before sending to the provider', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)

    // Seed a thread with 6 messages, attribute to (user u-cap, agent ChatAgent).
    const seed: AiMessage[] = []
    for (let i = 0; i < 6; i++) seed.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` })
    const id = await store.create(undefined, { userId: 'u-cap', agent: 'ChatAgent' })
    await store.append(id, seed)

    ChatAgent.lastUser = 'u-cap'
    ChatAgent.lastSpec = { historyLimit: 2 }
    fake.respondWith('after-cap')
    await new ChatAgent().prompt('next')

    const call = fake.getCalls()[0]!
    // Last 2 of seed = [m4 (user), m5 (assistant)]; new turn appends 'next'.
    // The fake captures `messages` by reference so the assistant-side gets
    // mutated post-call — assert on user-side only for stability.
    const userMessages = call.messages.filter(m => m.role === 'user').map(m => m.content)
    assert.deepStrictEqual(userMessages, ['m4', 'next'])
  })

  it('throws when auto-persist is enabled but no ConversationStore is registered', async () => {
    fake.respondWith('hi')
    ChatAgent.lastUser = 'u-1'
    await assert.rejects(() => new ChatAgent().prompt('hi'), /No ConversationStore registered/)
  })
})

// ─── Streaming variant ────────────────────────────────────

describe('Auto-persist on Agent.stream()', () => {
  let fake: AiFake

  beforeEach(() => {
    fake = AiFake.fake()
    ChatAgent.lastUser    = undefined
    ChatAgent.lastSpec    = undefined
    ChatAgent.asyncDelay  = 0
    setConversationStore(undefined as unknown as never)
  })

  it('invokes conversational() exactly once per stream() call', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('once')

    let calls = 0
    class CountingAgent extends Agent {
      instructions() { return 'count me' }
      // Async, so stream() cannot take its synchronous fast path.
      async conversational(): Promise<ConversationalSpec> {
        calls++
        return { user: 'u-count' }
      }
    }

    const { stream, response } = new CountingAgent().stream('hi')
    for await (const _c of stream) { /* drain */ }
    await response
    // Calling it twice repeats the override's side effects (a DI or DB lookup)
    // and leaves the first promise unhandled if it rejects.
    assert.equal(calls, 1)
  })

  it('streams through and persists at the end', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('streamed reply')

    ChatAgent.lastUser = 'u-stream'
    const { stream, response } = new ChatAgent().stream('hi')

    let chunks = ''
    for await (const c of stream) {
      if (c.type === 'text-delta' && c.text) chunks += c.text
    }
    const r = await response
    assert.equal(chunks, 'streamed reply')
    assert.ok(r.conversationId)
    const persisted = await store.load(r.conversationId!)
    assert.equal(persisted.length, 2)
  })

  it('stateless agent.stream() bypasses persistence entirely', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('plain')

    const { stream, response } = new StatelessAgent().stream('hi')
    for await (const _ of stream) { /* drain */ void _ }
    const r: AgentResponse = await response
    assert.equal(r.conversationId, undefined)
    assert.deepStrictEqual(await store.list(), [])
  })
})

// ─── Explicit form (forUser/continue) precedence ──────────

describe('Explicit forUser / continue precedence', () => {
  let fake: AiFake

  beforeEach(() => {
    fake = AiFake.fake()
    ChatAgent.lastUser = undefined
    setConversationStore(undefined as unknown as never)
  })

  it('forUser() shadow-overrides the class declaration', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('ok')

    ChatAgent.lastUser = 'u-class'  // class would say u-class
    const r = await new ChatAgent().forUser('u-explicit').prompt('hi')

    const explicitList = await store.list('u-explicit')
    assert.equal(explicitList.length, 1)
    assert.equal(explicitList[0]!.id, r.conversationId)
    assert.deepStrictEqual(await store.list('u-class'), [])
  })

  it('continue() loads the exact thread regardless of conversational()', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    const id = await store.create(undefined, { userId: 'u-owner' })
    await store.append(id, [{ role: 'user', content: 'old' }])

    fake.respondWith('continued')
    ChatAgent.lastUser = 'u-class'  // class would route to u-class
    const r = await new ChatAgent().forUser('u-owner').continue(id).prompt('next')

    assert.equal(r.conversationId, id, 'continue(id) wins over class declaration')
    const messages = await store.load(id)
    assert.deepStrictEqual(messages.map(m => m.content), ['old', 'next', 'continued'])
  })
})

// ─── Ownership of a resumed thread (#984) ─────────────────

describe('Resume-by-id owner check', () => {
  let fake: AiFake

  beforeEach(() => {
    fake = AiFake.fake()
    ChatAgent.lastUser = undefined
    setConversationStore(undefined as unknown as never)
  })

  /** Seed a thread owned by `userId` holding one message. */
  async function seed(store: MemoryConversationStore, userId?: string): Promise<string> {
    const id = await store.create(undefined, userId ? { userId, agent: 'ChatAgent' } : undefined)
    await store.append(id, [{ role: 'user', content: 'bob-secret' }])
    return id
  }

  it('forUser(alice).continue(bobsThread) is refused and leaves the thread untouched', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('leaked?')
    const bobs = await seed(store, 'bob')

    await assert.rejects(
      () => new ChatAgent().forUser('alice').continue(bobs).prompt('what did bob say?'),
      /is owned by a different user/,
    )

    // Neither read into the run nor appended to.
    assert.equal(fake.getCalls().length, 0, 'the provider never saw bob history')
    const messages = await store.load(bobs)
    assert.deepStrictEqual(messages.map(m => m.content), ['bob-secret'])
  })

  it('rejects with ConversationOwnershipError carrying the id and the scoped user', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('leaked?')
    const bobs = await seed(store, 'bob')

    const err = await new ChatAgent().forUser('alice').continue(bobs).prompt('hi').then(
      () => null,
      (e: unknown) => e,
    )
    assert.ok(err instanceof ConversationOwnershipError, `expected ConversationOwnershipError, got ${String(err)}`)
    assert.equal(err.conversationId, bobs)
    assert.equal(err.userId, 'alice')
    assert.ok(!err.message.includes('bob'), 'the message must not name the real owner')
  })

  it('per-call { conversation: { user, id } } is refused across users too', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('leaked?')
    const bobs = await seed(store, 'bob')

    await assert.rejects(
      () => new StatelessAgent().prompt('what did bob say?', { conversation: { user: 'alice', id: bobs } }),
      /is owned by a different user/,
    )
    assert.equal(fake.getCalls().length, 0)
  })

  it('streaming refuses before any chunk is produced', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('leaked?')
    const bobs = await seed(store, 'bob')

    const { stream, response } = new ChatAgent().forUser('alice').continue(bobs).stream('hi')
    await assert.rejects(async () => { for await (const _c of stream) { void _c } }, /is owned by a different user/)
    await assert.rejects(() => response, /is owned by a different user/)
    assert.equal(fake.getCalls().length, 0)
  })

  it('the owner still resumes their own thread by id', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('welcome back')
    const bobs = await seed(store, 'bob')

    const r = await new ChatAgent().forUser('bob').continue(bobs).prompt('me again')
    assert.equal(r.conversationId, bobs)
    const messages = await store.load(bobs)
    assert.deepStrictEqual(messages.map(m => m.content), ['bob-secret', 'me again', 'welcome back'])
  })

  it('a thread with no stored owner stays resumable by a bare continue()', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('still open')
    const orphan = await seed(store)  // pre-#984 row: created without meta

    const r = await new ChatAgent().continue(orphan).prompt('resume me')
    assert.equal(r.conversationId, orphan)
    const messages = await store.load(orphan)
    assert.deepStrictEqual(messages.map(m => m.content), ['bob-secret', 'resume me', 'still open'])
  })

  it('a bare continue() on an owned thread is refused like any other mismatch', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('leaked?')
    const bobs = await seed(store, 'bob')

    await assert.rejects(
      () => new ChatAgent().continue(bobs).prompt('no user here'),
      /chain forUser\(ownerId\)/,
    )
  })

  it('a store that does not report userId keeps its old permissive behavior', async () => {
    // The check reads the owner off list() entries, so a store that omits it
    // cannot be enforced — it must not start failing closed instead.
    const store = new MemoryConversationStore()
    const bobs = await seed(store, 'bob')
    const blind: ConversationStore = {
      create: (t, m) => store.create(t, m),
      load:   id => store.load(id),
      append: (id, m) => store.append(id, m),
      setTitle: (id, t) => store.setTitle(id, t),
      list: async userId => (await store.list(userId)).map(({ userId: _drop, ...rest }) => rest),
    }
    setConversationStore(blind)
    fake.respondWith('as before')

    const r = await new ChatAgent().forUser('alice').continue(bobs).prompt('hi')
    assert.equal(r.conversationId, bobs)
  })
})
