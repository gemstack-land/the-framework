import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, setUserMemory, resolveUserMemory } from './agent.js'
import { MemoryUserMemory, resolveRemembersSpec } from './memory.js'
import type { RemembersSpec, UserMemory } from './types.js'

// ─── MemoryUserMemory ─────────────────────────────────────

describe('MemoryUserMemory', () => {
  let mem: MemoryUserMemory

  beforeEach(() => { mem = new MemoryUserMemory() })

  it('remember stamps id, userId, fact, createdAt and persists optional tags + score', async () => {
    const e = await mem.remember('u-1', 'Project name is Foo', { tags: ['project'], score: 0.9 })
    assert.ok(e.id, 'id assigned')
    assert.equal(e.userId, 'u-1')
    assert.equal(e.fact, 'Project name is Foo')
    assert.deepStrictEqual(e.tags, ['project'])
    assert.equal(e.score, 0.9)
    assert.ok(e.createdAt instanceof Date)
  })

  it('omits optional fields when not provided (exactOptionalPropertyTypes)', async () => {
    const e = await mem.remember('u-1', 'bare fact')
    assert.equal('tags'  in e, false)
    assert.equal('score' in e, false)
  })

  it('list returns only the user’s own facts', async () => {
    await mem.remember('u-1', 'alice fact')
    await mem.remember('u-2', 'bob fact')
    const own = await mem.list('u-1')
    assert.deepStrictEqual(own.map(e => e.fact), ['alice fact'])
  })

  it('list filters by tag intersection', async () => {
    await mem.remember('u-1', 'a', { tags: ['x', 'y'] })
    await mem.remember('u-1', 'b', { tags: ['x'] })
    await mem.remember('u-1', 'c', { tags: ['z'] })
    await mem.remember('u-1', 'd')
    const xy = await mem.list('u-1', { tags: ['x', 'y'] })
    assert.deepStrictEqual(xy.map(e => e.fact), ['a'])
    const x  = await mem.list('u-1', { tags: ['x'] })
    assert.deepStrictEqual(x.map(e => e.fact).sort(), ['a', 'b'])
  })

  it('recall does case-insensitive substring matching against fact + tags', async () => {
    await mem.remember('u-1', 'Project name is Foo')
    await mem.remember('u-1', 'lives in Paris',  { tags: ['location'] })
    await mem.remember('u-1', 'unrelated thing')

    const byFact = await mem.recall('u-1', 'project')
    assert.deepStrictEqual(byFact.map(e => e.fact), ['Project name is Foo'])

    const byTag = await mem.recall('u-1', 'LOCATION')
    assert.deepStrictEqual(byTag.map(e => e.fact), ['lives in Paris'])
  })

  it('recall caps with limit', async () => {
    for (let i = 0; i < 5; i++) await mem.remember('u-1', `item ${i}`, { tags: ['n'] })
    const r = await mem.recall('u-1', 'item', { limit: 2 })
    assert.equal(r.length, 2)
  })

  it('recall scoped by tag filter intersects', async () => {
    await mem.remember('u-1', 'item alpha', { tags: ['t1'] })
    await mem.remember('u-1', 'item beta',  { tags: ['t2'] })
    const r = await mem.recall('u-1', 'item', { tags: ['t1'] })
    assert.deepStrictEqual(r.map(e => e.fact), ['item alpha'])
  })

  it('recall returns empty when nothing matches', async () => {
    await mem.remember('u-1', 'a')
    const r = await mem.recall('u-1', 'zzz')
    assert.deepStrictEqual(r, [])
  })

  it('forget removes the fact only when the user owns it', async () => {
    const own  = await mem.remember('u-1', 'mine')
    const them = await mem.remember('u-2', 'theirs')

    await mem.forget('u-1', them.id)              // wrong owner: no-op
    assert.equal((await mem.list('u-2')).length, 1)

    await mem.forget('u-1', own.id)
    assert.deepStrictEqual(await mem.list('u-1'), [])
  })

  it('forget on unknown id is a silent no-op (idempotent)', async () => {
    await assert.doesNotReject(mem.forget('u-1', 'does-not-exist'))
  })

  it('forgetAll wipes a single user without touching others', async () => {
    await mem.remember('u-1', 'a')
    await mem.remember('u-1', 'b')
    await mem.remember('u-2', 'c')
    await mem.forgetAll!('u-1')
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.equal((await mem.list('u-2')).length, 1)
  })
})

// ─── resolveRemembersSpec ─────────────────────────────────

describe('resolveRemembersSpec', () => {
  it('returns null when both per-call and class agree on opt-out', async () => {
    assert.equal(await resolveRemembersSpec(() => false, undefined), null)
  })

  it('per-call false wins over class declaration', async () => {
    assert.equal(await resolveRemembersSpec(() => ({ user: 'u' }), false), null)
  })

  it('per-call object replaces class declaration', async () => {
    const r = await resolveRemembersSpec(() => ({ user: 'class' }), { user: 'percall' })
    assert.deepStrictEqual(r, { user: 'percall' })
  })

  it('falls back to class declaration when per-call omitted', async () => {
    const r = await resolveRemembersSpec(() => ({ user: 'class' }), undefined)
    assert.deepStrictEqual(r, { user: 'class' })
  })

  it('awaits async class declaration', async () => {
    const r = await resolveRemembersSpec(() => Promise.resolve({ user: 'async-u' }), undefined)
    assert.deepStrictEqual(r, { user: 'async-u' })
  })

  it('rejects spec lacking user', async () => {
    const r = await resolveRemembersSpec(() => ({ user: '' }) as RemembersSpec, undefined)
    assert.equal(r, null)
  })

  it('preserves inject/extract/tags/limit fields from per-call spec', async () => {
    const spec: RemembersSpec = {
      user:        'u',
      inject:      'auto',
      extract:     'auto',
      extractWith: 'anthropic/claude-haiku-4-5',
      tags:        ['support'],
      injectLimit: 5,
    }
    const r = await resolveRemembersSpec(() => false, spec)
    assert.deepStrictEqual(r, spec)
  })
})

// ─── Agent.remembers() default + DI lookup ────────────────

describe('Agent.remembers()', () => {
  class StatelessAgent extends Agent {
    instructions() { return 'I do not remember.' }
  }

  class SupportAgent extends Agent {
    static user: string | undefined
    instructions() { return 'Support agent.' }
    remembers() { return SupportAgent.user ? { user: SupportAgent.user, inject: 'auto' as const } : false }
  }

  it('default returns false (memory-stateless)', () => {
    assert.equal(new StatelessAgent().remembers(), false)
  })

  it('subclass override is respected', () => {
    SupportAgent.user = 'u-1'
    assert.deepStrictEqual(new SupportAgent().remembers(), { user: 'u-1', inject: 'auto' })
    SupportAgent.user = undefined
    assert.equal(new SupportAgent().remembers(), false)
  })

  it('precedence chain (per-call → class → default) matches resolveRemembersSpec', async () => {
    SupportAgent.user = 'class-u'
    const a = new SupportAgent()

    // 1. per-call false beats class
    assert.equal(
      await resolveRemembersSpec(() => a.remembers(), false),
      null,
    )
    // 2. per-call spec replaces class
    assert.deepStrictEqual(
      await resolveRemembersSpec(() => a.remembers(), { user: 'percall-u' }),
      { user: 'percall-u' },
    )
    // 3. omitted per-call falls through to class
    assert.deepStrictEqual(
      await resolveRemembersSpec(() => a.remembers(), undefined),
      { user: 'class-u', inject: 'auto' },
    )

    SupportAgent.user = undefined
  })
})

describe('setUserMemory / resolveUserMemory', () => {
  beforeEach(() => { setUserMemory(undefined as unknown as UserMemory) })

  it('returns undefined before anything is registered', () => {
    assert.equal(resolveUserMemory(), undefined)
  })

  it('round-trips a registered memory store', () => {
    const mem = new MemoryUserMemory()
    setUserMemory(mem)
    assert.equal(resolveUserMemory(), mem)
  })
})
