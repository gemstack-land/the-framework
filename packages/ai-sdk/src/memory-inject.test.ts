import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, setUserMemory } from './agent.js'
import { AiFake } from './fake.js'
import { MemoryUserMemory, type UserMemoryLookup } from './memory.js'
import { withMemoryInject } from './memory-inject.js'
import type { AiMessage, RemembersSpec, UserMemory } from './types.js'

// ─── Helpers ──────────────────────────────────────────────

function getSystemContent(messages: AiMessage[]): string {
  const sys = messages[0]
  if (!sys || sys.role !== 'system') throw new Error('expected first message to be system')
  return typeof sys.content === 'string'
    ? sys.content
    : sys.content.map(p => (p.type === 'text' ? p.text : '')).join('')
}

class BaseSupport extends Agent {
  instructions() { return 'You are a support agent.' }
}

// ─── Standalone middleware (manual install via agent.middleware()) ──

describe('withMemoryInject — standalone middleware', () => {
  let fake: AiFake
  let mem:  MemoryUserMemory

  beforeEach(() => {
    fake = AiFake.fake()
    mem  = new MemoryUserMemory()
    fake.respondWith('ok')
  })
  afterEach(() => { fake.restore() })

  it('prepends a <user-memory> block to the system prompt before the model call', async () => {
    await mem.remember('u-1', 'Project name is Foo', { tags: ['project'] })
    await mem.remember('u-1', 'lives in Paris',      { tags: ['location'] })

    const spec: RemembersSpec = { user: 'u-1' }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    await new A().prompt('what is my project?')

    const calls = fake.getCalls()
    assert.equal(calls.length, 1)
    const sys = getSystemContent(calls[0]!.messages)
    assert.match(sys, /^You are a support agent\./)
    assert.match(sys, /<user-memory>/)
    assert.match(sys, /- Project name is Foo/)
    assert.doesNotMatch(sys, /- lives in Paris/, 'only the substring-matched fact is included')
  })

  it('applies tag scope from the spec — non-matching tags drop out of recall', async () => {
    await mem.remember('u-1', 'item alpha', { tags: ['support'] })
    await mem.remember('u-1', 'item beta',  { tags: ['billing'] })

    const spec: RemembersSpec = { user: 'u-1', tags: ['support'] }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    await new A().prompt('item')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /- item alpha/)
    assert.doesNotMatch(sys, /- item beta/)
  })

  it('caps the block by injectLimit', async () => {
    for (let i = 0; i < 5; i++) {
      await mem.remember('u-1', `item ${i}`)
    }
    const spec: RemembersSpec = { user: 'u-1', injectLimit: 2 }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    await new A().prompt('item')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    const matches = sys.match(/^- item \d/gm) ?? []
    assert.equal(matches.length, 2)
  })

  it('drops lowest-score facts first when injectTokenBudget is exceeded', async () => {
    await mem.remember('u-1', 'AAAA fact-low',    { score: 0.1 })
    await mem.remember('u-1', 'BBBB fact-medium', { score: 0.5 })
    await mem.remember('u-1', 'CCCC fact-high',   { score: 0.95 })

    // Char-budget ≈ 4 * tokens. Pick a budget that lets only the top
    // fact in once the wrapper overhead is accounted for.
    const spec: RemembersSpec = { user: 'u-1', injectTokenBudget: 12 }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem, estimateTokens: t => Math.ceil(t.length / 4) })] }
    }

    await new A().prompt('fact')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /CCCC fact-high/)
    assert.doesNotMatch(sys, /AAAA fact-low/)
    assert.doesNotMatch(sys, /BBBB fact-medium/)
  })

  it('skips silently when no UserMemory is registered (lookup returns undefined)', async () => {
    const spec: RemembersSpec = { user: 'u-1' }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: (() => undefined) as UserMemoryLookup })] }
    }

    await new A().prompt('hi')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })

  it('skips silently when recall returns no facts', async () => {
    // memory exists but has nothing for this user
    const spec: RemembersSpec = { user: 'u-1' }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    await new A().prompt('anything')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })

  it('skips when the budget is too small for even the top fact', async () => {
    await mem.remember('u-1', 'a-fact-too-large-to-fit', { score: 1 })
    const spec: RemembersSpec = { user: 'u-1', injectTokenBudget: 1 }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    await new A().prompt('a-fact')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })

  it('uses the latest user message as the recall query (multi-turn history)', async () => {
    await mem.remember('u-1', 'Project is Foo')
    await mem.remember('u-1', 'lives in Paris')

    const spec: RemembersSpec = { user: 'u-1' }
    class A extends BaseSupport {
      middleware() { return [withMemoryInject(spec, { lookup: () => mem })] }
    }

    const history: AiMessage[] = [
      { role: 'user',      content: 'where do i live?' },
      { role: 'assistant', content: 'paris' },
    ]
    await new A().prompt('what is my project?', { history })

    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /Project is Foo/, 'matched on the LATEST user msg, not the older one')
    assert.doesNotMatch(sys, /lives in Paris/)
  })
})

// ─── Auto-cascade via Agent.remembers() ───────────────────

describe('Agent.remembers() auto-cascade', () => {
  let fake: AiFake
  let mem:  MemoryUserMemory

  beforeEach(() => {
    fake = AiFake.fake()
    mem  = new MemoryUserMemory()
    setUserMemory(mem)
    fake.respondWith('ok')
  })
  afterEach(() => {
    fake.restore()
    setUserMemory(undefined as unknown as UserMemory)
  })

  it('inject: "auto" installs the middleware automatically — system prompt grows', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', inject: 'auto' }
      }
    }

    await new A().prompt('what is my project?')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /<user-memory>/)
    assert.match(sys, /- Project is Foo/)
  })

  it('inject !== "auto" leaves the loop untouched', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', inject: 'manual' }
      }
    }

    await new A().prompt('what is my project?')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })

  it('per-call options.memory: false disables auto-inject for that call', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', inject: 'auto' }
      }
    }

    await new A().prompt('what is my project?', { memory: false })
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })

  it('per-call options.memory replaces the class spec (different user)', async () => {
    await mem.remember('u-class',   'class fact')
    await mem.remember('u-percall', 'percall fact')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-class', inject: 'auto' }
      }
    }

    await new A().prompt('fact', { memory: { user: 'u-percall', inject: 'auto' } })
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /- percall fact/)
    assert.doesNotMatch(sys, /- class fact/)
  })

  it('continuation calls (options.messages) skip injection — no duplicate block', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', inject: 'auto' }
      }
    }

    // Simulate a continuation: caller already-built messages; the prior
    // turn's system prompt was already augmented in their world.
    const messages: AiMessage[] = [
      { role: 'user',      content: 'what is my project?' },
      { role: 'assistant', content: 'I will check.' },
      { role: 'tool',      content: '{ "ok": true }', toolCallId: 't1' },
    ]
    await new A().prompt('', { messages })

    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/, 'no injection on continuation')
  })

  it('async remembers() is awaited', async () => {
    await mem.remember('u-async', 'async-resolved fact')

    class A extends BaseSupport {
      remembers(): Promise<false | RemembersSpec> {
        return Promise.resolve({ user: 'u-async', inject: 'auto' })
      }
    }

    await new A().prompt('fact')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /- async-resolved fact/)
  })

  it('streaming path also auto-injects', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', inject: 'auto' }
      }
    }

    const stream = new A().stream('what is my project?')
    for await (const _ of stream.stream) { /* drain */ }
    await stream.response

    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.match(sys, /<user-memory>/)
    assert.match(sys, /- Project is Foo/)
  })

  it('auto-cascade does NOT install when remembers() returns false', async () => {
    await mem.remember('u-1', 'Project is Foo')

    class A extends BaseSupport {
      remembers(): false { return false }
    }

    await new A().prompt('what is my project?')
    const sys = getSystemContent(fake.getCalls()[0]!.messages)
    assert.doesNotMatch(sys, /<user-memory>/)
  })
})
