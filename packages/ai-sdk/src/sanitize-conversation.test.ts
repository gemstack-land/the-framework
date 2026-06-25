import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeConversation } from './sanitize-conversation.js'
import type { AiMessage } from './types.js'

const user = (content: string): AiMessage => ({ role: 'user', content })
const assistant = (content: string, toolCalls?: AiMessage['toolCalls']): AiMessage =>
  toolCalls ? { role: 'assistant', content, toolCalls } : { role: 'assistant', content }
const tool = (toolCallId: string, content = 'ok'): AiMessage => ({ role: 'tool', content, toolCallId })
const call = (id: string, name = 'fn') => ({ id, name, arguments: {} })

describe('sanitizeConversation', () => {
  it('passes through plain conversations untouched', () => {
    const msgs = [user('hi'), assistant('hello'), user('bye')]
    assert.deepStrictEqual(sanitizeConversation(msgs), msgs)
  })

  it('keeps a complete single-call tool turn', () => {
    const msgs = [
      user('do it'),
      assistant('working', [call('a')]),
      tool('a', 'done'),
      assistant('finished'),
    ]
    assert.deepStrictEqual(sanitizeConversation(msgs), msgs)
  })

  it('keeps a complete multi-call tool turn', () => {
    const msgs = [
      assistant('two calls', [call('a'), call('b')]),
      tool('a'),
      tool('b'),
    ]
    assert.deepStrictEqual(sanitizeConversation(msgs), msgs)
  })

  it('re-emits results in toolCalls order, one per call', () => {
    const out = sanitizeConversation([
      assistant('x', [call('a'), call('b')]),
      tool('b', 'B'),
      tool('a', 'A'),
    ])
    assert.deepStrictEqual(out.map(m => m.role), ['assistant', 'tool', 'tool'])
    assert.equal(out[1]!.toolCallId, 'a')
    assert.equal(out[2]!.toolCallId, 'b')
  })

  it('drops an extra / orphan tool message interleaved in a complete run', () => {
    const out = sanitizeConversation([
      assistant('x', [call('a')]),
      tool('a', 'A'),
      tool('zzz', 'stray'),
    ])
    assert.equal(out.length, 2)
    assert.deepStrictEqual(out.map(m => m.toolCallId), [undefined, 'a'])
  })

  it('drops a duplicate result for the same id (first wins)', () => {
    const out = sanitizeConversation([
      assistant('x', [call('a')]),
      tool('a', 'first'),
      tool('a', 'second'),
    ])
    assert.equal(out.length, 2)
    assert.equal(out[1]!.content, 'first')
  })

  it('strips a dangling tool turn but keeps its text', () => {
    const out = sanitizeConversation([
      user('go'),
      assistant('partial answer', [call('a'), call('b')]),
      tool('a'), // b never answered
    ])
    assert.deepStrictEqual(out.map(m => m.role), ['user', 'assistant'])
    assert.equal(out[1]!.content, 'partial answer')
    assert.equal(out[1]!.toolCalls, undefined)
  })

  it('drops a dangling tool turn entirely when it has no text', () => {
    const out = sanitizeConversation([
      user('go'),
      assistant('', [call('a')]), // no results at all
    ])
    assert.deepStrictEqual(out, [user('go')])
  })

  it('drops a dangling turn with no following tool messages', () => {
    const out = sanitizeConversation([
      assistant('thinking', [call('a')]),
    ])
    assert.deepStrictEqual(out.map(m => m.role), ['assistant'])
    assert.equal(out[0]!.toolCalls, undefined)
  })

  it('drops an orphan tool result whose parent is missing', () => {
    const out = sanitizeConversation([
      user('hi'),
      tool('ghost', 'leftover'),
      assistant('ok'),
    ])
    assert.deepStrictEqual(out, [user('hi'), assistant('ok')])
  })

  it('drops orphan results left behind after a dangling parent is stripped', () => {
    // assistant declares a+b, only a answered -> dangling -> stripped;
    // the `a` result must NOT resurface as an orphan.
    const out = sanitizeConversation([
      assistant('partial', [call('a'), call('b')]),
      tool('a'),
    ])
    assert.deepStrictEqual(out.map(m => m.role), ['assistant'])
  })

  it('is idempotent', () => {
    const msgs = [
      user('go'),
      assistant('partial', [call('a'), call('b')]),
      tool('a'),
      tool('zzz'),
      assistant('two', [call('c')]),
      tool('c'),
    ]
    const once = sanitizeConversation(msgs)
    const twice = sanitizeConversation(once)
    assert.deepStrictEqual(twice, once)
  })

  it('returns an empty array for empty input', () => {
    assert.deepStrictEqual(sanitizeConversation([]), [])
  })
})
