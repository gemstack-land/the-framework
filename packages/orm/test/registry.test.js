// The adapter registry (#66): the app sets one runtime adapter, every extension
// reads the same one. Each test file runs in its own process, so the globalThis
// registry starts clean; clearAdapter() resets between cases within this file.

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setAdapter, getAdapter, clearAdapter, ADAPTER_OPS } from '../src/index.js'

const noop = async () => {}
const fakeAdapter = () => Object.fromEntries(ADAPTER_OPS.map((op) => [op, noop]))

afterEach(() => clearAdapter())

test('getAdapter is null until the app sets one', () => {
  assert.equal(getAdapter(), null)
})

test('setAdapter then getAdapter returns the same instance', () => {
  const a = fakeAdapter()
  setAdapter(a)
  assert.equal(getAdapter(), a)
})

test('setAdapter replaces a previously registered adapter', () => {
  const a = fakeAdapter()
  const b = fakeAdapter()
  setAdapter(a)
  setAdapter(b)
  assert.equal(getAdapter(), b)
})

test('clearAdapter resets the registry', () => {
  setAdapter(fakeAdapter())
  clearAdapter()
  assert.equal(getAdapter(), null)
})

test('a non-object is rejected with a clear error', () => {
  assert.throws(() => setAdapter(null), /expected an adapter object/)
  assert.throws(() => setAdapter('drizzle'), /expected an adapter object/)
})

test('an adapter missing an operation is rejected, naming the op', () => {
  const incomplete = fakeAdapter()
  delete incomplete.upsert
  assert.throws(() => setAdapter(incomplete), /missing the "upsert" operation/)
})
