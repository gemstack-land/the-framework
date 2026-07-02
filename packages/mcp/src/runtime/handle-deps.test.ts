import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOrConstruct } from './handle-deps.js'
import { createResolver, type McpResolver } from '../resolver.js'

class Widget {
  readonly kind = 'widget'
}

test('resolveOrConstruct plain-constructs with no resolver', () => {
  assert.ok(resolveOrConstruct(Widget) instanceof Widget)
})

test('the built-in resolver constructs an unregistered class', () => {
  const out = resolveOrConstruct(Widget, createResolver())
  assert.ok(out instanceof Widget)
})

test('a has()-aware resolver lets a genuine construction failure propagate', () => {
  // The token IS owned (has → true) but building it throws: this is a real DI
  // misconfiguration and must NOT be masked by a plain new Ctor().
  const resolver: McpResolver = {
    has: () => true,
    resolve: () => {
      throw new Error('missing constructor dependency')
    },
  }
  assert.throws(() => resolveOrConstruct(Widget, resolver), /missing constructor dependency/)
})

test('a has()-aware resolver skips resolve() for tokens it does not own', () => {
  let resolveCalls = 0
  const resolver: McpResolver = {
    has: () => false,
    resolve: () => {
      resolveCalls++
      return undefined
    },
  }
  assert.ok(resolveOrConstruct(Widget, resolver) instanceof Widget)
  assert.equal(resolveCalls, 0)
})

test('a legacy resolver without has() still falls back on a throw', () => {
  const resolver: McpResolver = {
    resolve: () => {
      throw new Error('unknown token')
    },
  }
  assert.ok(resolveOrConstruct(Widget, resolver) instanceof Widget)
})

test('a legacy resolver returning undefined falls back to a plain constructor', () => {
  const resolver: McpResolver = { resolve: () => undefined }
  assert.ok(resolveOrConstruct(Widget, resolver) instanceof Widget)
})
