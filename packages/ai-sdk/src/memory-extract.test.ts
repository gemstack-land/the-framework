import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, setUserMemory } from './agent.js'
import { AiFake } from './fake.js'
import { MemoryUserMemory } from './memory.js'
import { withMemoryExtract } from './memory-extract.js'
import type { MemoryEntry, RemembersSpec, UserMemory } from './types.js'

class BaseSupport extends Agent {
  instructions() { return 'You are a support agent.' }
}

// Helpers ─────────────────────────────────────────────────

const FACTS_OK = JSON.stringify({
  facts: [
    { fact: 'Project name is Foo',  score: 0.95, tags: ['project'] },
    { fact: 'lives in Paris',       score: 0.80 },
    { fact: 'shaky guess',          score: 0.40 },   // below 0.7 threshold
  ],
})

const FACTS_EMPTY = JSON.stringify({ facts: [] })

const FACTS_WITH_TAGS = JSON.stringify({
  facts: [{ fact: 'uses Drizzle', score: 0.9, tags: ['stack'] }],
})

// ─── Standalone middleware (manual install) ───────────────

describe('withMemoryExtract — standalone middleware', () => {
  let fake: AiFake
  let mem:  MemoryUserMemory

  beforeEach(() => {
    fake = AiFake.fake()
    mem  = new MemoryUserMemory()
  })
  afterEach(() => { fake.restore() })

  it('extracts facts above threshold and persists them via remember()', async () => {
    fake.respondWithSequence([
      { text: 'sure thing' },     // parent prompt response
      { text: FACTS_OK },         // small-model extract response
    ])

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
    let captured: MemoryEntry[] | null = null
    class A extends BaseSupport {
      middleware() { return [withMemoryExtract(spec, { lookup: () => mem, onExtracted: e => { captured = e } })] }
    }

    await new A().prompt('hello, my project is named Foo')
    const stored = await mem.list('u-1')
    assert.equal(stored.length, 2, 'two facts above threshold persisted')
    assert.deepStrictEqual(stored.map(e => e.fact).sort(), ['Project name is Foo', 'lives in Paris'])
    assert.equal(stored.find(e => e.fact === 'shaky guess'), undefined, 'sub-threshold dropped')
    assert.ok(captured, 'onExtracted fired')
    assert.equal((captured as MemoryEntry[]).length, 2)
  })

  it('honors a custom threshold', async () => {
    fake.respondWithSequence([
      { text: 'ok' },
      { text: FACTS_OK },
    ])

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
    class A extends BaseSupport {
      middleware() {
        return [withMemoryExtract(spec, { lookup: () => mem, threshold: 0.85 })]
      }
    }

    await new A().prompt('hi')
    const stored = await mem.list('u-1')
    assert.deepStrictEqual(stored.map(e => e.fact), ['Project name is Foo'])
  })

  it('unions tags from the spec into every persisted entry', async () => {
    fake.respondWithSequence([
      { text: 'ok' },
      { text: FACTS_WITH_TAGS },
    ])

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model', tags: ['support'] }
    class A extends BaseSupport {
      middleware() { return [withMemoryExtract(spec, { lookup: () => mem })] }
    }

    await new A().prompt('hi')
    const stored = await mem.list('u-1')
    assert.equal(stored.length, 1)
    assert.deepStrictEqual([...stored[0]!.tags!].sort(), ['stack', 'support'])
  })

  it('writes nothing when the model returns an empty fact list', async () => {
    fake.respondWithSequence([
      { text: 'ok' },
      { text: FACTS_EMPTY },
    ])

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
    let captured: MemoryEntry[] | null = null
    class A extends BaseSupport {
      middleware() {
        return [withMemoryExtract(spec, { lookup: () => mem, onExtracted: e => { captured = e } })]
      }
    }

    await new A().prompt('hi')
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.deepStrictEqual(captured, [])
  })

  it('skips silently when extract is not "auto"', async () => {
    fake.respondWith('ok')

    const spec: RemembersSpec = { user: 'u-1', extract: 'manual', extractWith: '__fake__/small-model' }
    class A extends BaseSupport {
      middleware() { return [withMemoryExtract(spec, { lookup: () => mem })] }
    }

    await new A().prompt('hi')
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.equal(fake.getCalls().length, 1, 'no second call to the small model')
  })

  it('skips silently when extractWith is missing', async () => {
    fake.respondWith('ok')

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto' }   // no extractWith
    class A extends BaseSupport {
      middleware() { return [withMemoryExtract(spec, { lookup: () => mem })] }
    }

    await new A().prompt('hi')
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.equal(fake.getCalls().length, 1)
  })

  it('skips silently when no UserMemory is registered', async () => {
    fake.respondWith('ok')

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
    class A extends BaseSupport {
      middleware() { return [withMemoryExtract(spec, { lookup: () => undefined })] }
    }

    await new A().prompt('hi')
    assert.equal(fake.getCalls().length, 1)   // no extract call
  })

  it('routes errors through onError without breaking the parent', async () => {
    fake.respondWithSequence([
      { text: 'parent reply' },
      { text: 'NOT JSON AT ALL' },   // extract parse failure
    ])

    const spec: RemembersSpec = { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
    let caught: unknown = null
    class A extends BaseSupport {
      middleware() {
        return [withMemoryExtract(spec, { lookup: () => mem, onError: err => { caught = err } })]
      }
    }

    const r = await new A().prompt('hi')
    assert.equal(r.text, 'parent reply', 'parent prompt completed normally')
    assert.deepStrictEqual(await mem.list('u-1'), [], 'no facts persisted')
    assert.ok(caught, 'onError fired with the parse failure')
  })
})

// ─── Auto-cascade via Agent.remembers() ───────────────────

describe('Agent.remembers() auto-extract cascade', () => {
  let fake: AiFake
  let mem:  MemoryUserMemory

  beforeEach(() => {
    fake = AiFake.fake()
    mem  = new MemoryUserMemory()
    setUserMemory(mem)
  })
  afterEach(() => {
    fake.restore()
    setUserMemory(undefined as unknown as UserMemory)
  })

  it('extract: "auto" + extractWith installs the middleware automatically', async () => {
    fake.respondWithSequence([
      { text: 'sure' },
      { text: FACTS_OK },
    ])

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
      }
    }

    await new A().prompt('my project is foo')
    const stored = await mem.list('u-1')
    assert.equal(stored.length, 2)
  })

  it('continuation calls (options.messages) skip extract auto-install', async () => {
    fake.respondWithSequence([
      { text: 'continuation reply' },
    ])

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
      }
    }

    await new A().prompt('', { messages: [
      { role: 'user', content: 'older question' },
      { role: 'tool', content: '{ "ok": true }', toolCallId: 't1' },
    ] })
    assert.deepStrictEqual(await mem.list('u-1'), [], 'no extract on continuation')
    assert.equal(fake.getCalls().length, 1, 'small model not invoked')
  })

  it('inject + extract both auto-install when both are "auto"', async () => {
    await mem.remember('u-1', 'pre-existing project fact')   // for inject

    fake.respondWithSequence([
      { text: 'parent reply' },
      { text: FACTS_OK },
    ])

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return {
          user: 'u-1',
          inject: 'auto',
          extract: 'auto',
          extractWith: '__fake__/small-model',
        }
      }
    }

    await new A().prompt('what about my project?')

    // Inject: parent prompt's system message should contain the recalled fact
    const parentMessages = fake.getCalls()[0]!.messages
    const sys = parentMessages[0]!
    const sysText = typeof sys.content === 'string' ? sys.content : ''
    assert.match(sysText, /pre-existing project fact/, 'inject prepended fact to parent system prompt')

    // Extract: post-finish, two new facts persisted
    const stored = await mem.list('u-1')
    const newFacts = stored.filter(e => e.fact !== 'pre-existing project fact')
    assert.equal(newFacts.length, 2)
  })

  it('failed parent run does NOT trigger extract', async () => {
    fake.failOnStep(0, new Error('provider down'))

    class A extends BaseSupport {
      remembers(): false | RemembersSpec {
        return { user: 'u-1', extract: 'auto', extractWith: '__fake__/small-model' }
      }
    }

    await assert.rejects(new A().prompt('hi'), /provider down/)
    assert.deepStrictEqual(await mem.list('u-1'), [], 'no extract on failure')
  })
})
