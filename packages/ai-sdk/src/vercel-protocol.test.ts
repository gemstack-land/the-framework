import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toVercelDataStream, toVercelResponse } from './vercel-protocol.js'
import type { StreamChunk } from './types.js'

function streamOf(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

/** Drain the data stream into its raw wire text. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

const wire = (chunks: StreamChunk[]) => drain(toVercelDataStream(streamOf(chunks)))

describe('toVercelDataStream — text', () => {
  it('emits each text delta as a 0: part holding a JSON string', async () => {
    assert.equal(
      await wire([
        { type: 'text-delta', text: 'Hi ' },
        { type: 'text-delta', text: 'there' },
      ]),
      '0:"Hi "\n0:"there"\n',
    )
  })

  it('JSON-escapes newlines and quotes inside a text delta', async () => {
    assert.equal(
      await wire([{ type: 'text-delta', text: 'a "b"\nc' }]),
      '0:"a \\"b\\"\\nc"\n',
    )
  })
})

describe('toVercelDataStream — tool call streaming', () => {
  it('emits the start on b: and argument deltas on c:', async () => {
    assert.equal(
      await wire([
        { type: 'tool-call-delta', toolCall: { id: 'call-1', name: 'lookup' } },
        { type: 'tool-call-delta', text: '{"q":' },
        { type: 'tool-call-delta', text: '"x"}' },
      ]),
      'b:{"toolCallId":"call-1","toolName":"lookup"}\n'
      + 'c:{"toolCallId":"call-1","argsTextDelta":"{\\"q\\":"}\n'
      + 'c:{"toolCallId":"call-1","argsTextDelta":"\\"x\\"}"}\n',
    )
  })

  it('never emits an argument delta on a: (that prefix is Tool Result)', async () => {
    const raw = await wire([
      { type: 'tool-call-delta', toolCall: { id: 'call-1', name: 'lookup' } },
      { type: 'tool-call-delta', text: '{}' },
    ])
    assert.equal(raw.includes('a:'), false)
    assert.equal(raw.includes('9:'), false)
  })

  it('routes parallel argument deltas by toolCallIndex', async () => {
    assert.equal(
      await wire([
        { type: 'tool-call-delta', toolCall: { id: 'call-a', name: 'one' }, toolCallIndex: 0 },
        { type: 'tool-call-delta', toolCall: { id: 'call-b', name: 'two' }, toolCallIndex: 1 },
        { type: 'tool-call-delta', text: 'A', toolCallIndex: 0 },
        { type: 'tool-call-delta', text: 'B', toolCallIndex: 1 },
      ]),
      'b:{"toolCallId":"call-a","toolName":"one"}\n'
      + 'b:{"toolCallId":"call-b","toolName":"two"}\n'
      + 'c:{"toolCallId":"call-a","argsTextDelta":"A"}\n'
      + 'c:{"toolCallId":"call-b","argsTextDelta":"B"}\n',
    )
  })

  it('emits start and delta in one frame when a chunk carries both', async () => {
    assert.equal(
      await wire([{ type: 'tool-call-delta', toolCall: { id: 'call-1', name: 'lookup' }, text: '{}' }]),
      'b:{"toolCallId":"call-1","toolName":"lookup"}\n'
      + 'c:{"toolCallId":"call-1","argsTextDelta":"{}"}\n',
    )
  })

  it('leaves toolCallId empty when no start was ever seen', async () => {
    assert.equal(
      await wire([{ type: 'tool-call-delta', text: '{}' }]),
      'c:{"toolCallId":"","argsTextDelta":"{}"}\n',
    )
  })
})

describe('toVercelDataStream — complete tool call', () => {
  it('emits 9: with toolCallId, toolName and args', async () => {
    assert.equal(
      await wire([{ type: 'tool-call', toolCall: { id: 'call-1', name: 'lookup', arguments: { q: 'x' } } }]),
      '9:{"toolCallId":"call-1","toolName":"lookup","args":{"q":"x"}}\n',
    )
  })

  it('defaults missing tool call fields rather than dropping keys', async () => {
    assert.equal(
      await wire([{ type: 'tool-call', toolCall: { id: 'call-1' } }]),
      '9:{"toolCallId":"call-1","toolName":"","args":{}}\n',
    )
  })

  it('emits nothing for a tool-call chunk with no toolCall', async () => {
    assert.equal(await wire([{ type: 'tool-call' }]), '')
  })
})

describe('toVercelDataStream — tool results', () => {
  it('emits a: with toolCallId and the result (#999)', async () => {
    assert.equal(
      await wire([{ type: 'tool-result', toolCall: { id: 'call-1', name: 'lookup' }, result: { hits: 2 } }]),
      'a:{"toolCallId":"call-1","result":{"hits":2}}\n',
    )
  })

  it('passes a string result through as a JSON string, not double-encoded', async () => {
    assert.equal(
      await wire([{ type: 'tool-result', toolCall: { id: 'call-1' }, result: 'plain string' }]),
      'a:{"toolCallId":"call-1","result":"plain string"}\n',
    )
  })

  it('null-fills an undefined result so the key survives JSON.stringify', async () => {
    assert.equal(
      await wire([{ type: 'tool-result', toolCall: { id: 'call-1' } }]),
      'a:{"toolCallId":"call-1","result":null}\n',
    )
  })

  it('emits the whole call/result sequence in protocol order', async () => {
    assert.equal(
      await wire([
        { type: 'tool-call-delta', toolCall: { id: 'call-1', name: 'lookup' } },
        { type: 'tool-call-delta', text: '{"q":"x"}' },
        { type: 'tool-call', toolCall: { id: 'call-1', name: 'lookup', arguments: { q: 'x' } } },
        { type: 'tool-result', toolCall: { id: 'call-1', name: 'lookup' }, result: { hits: 2 } },
        { type: 'text-delta', text: 'Found 2.' },
      ]),
      'b:{"toolCallId":"call-1","toolName":"lookup"}\n'
      + 'c:{"toolCallId":"call-1","argsTextDelta":"{\\"q\\":\\"x\\"}"}\n'
      + '9:{"toolCallId":"call-1","toolName":"lookup","args":{"q":"x"}}\n'
      + 'a:{"toolCallId":"call-1","result":{"hits":2}}\n'
      + '0:"Found 2."\n',
    )
  })
})

describe('toVercelDataStream — finish', () => {
  it('emits e: then d:, both carrying finishReason and usage', async () => {
    assert.equal(
      await wire([{
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }]),
      'e:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}\n'
      + 'd:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}\n',
    )
  })

  it('renames the tool_calls finish reason to the protocol tool-calls', async () => {
    assert.equal(
      await wire([{ type: 'finish', finishReason: 'tool_calls' }]),
      'e:{"finishReason":"tool-calls"}\nd:{"finishReason":"tool-calls"}\n',
    )
  })

  it('omits usage when the finish chunk has none', async () => {
    assert.equal(
      await wire([{ type: 'finish', finishReason: 'length' }]),
      'e:{"finishReason":"length"}\nd:{"finishReason":"length"}\n',
    )
  })
})

describe('toVercelDataStream — chunks with no v4 part', () => {
  it('drops usage, tool-update, pending and handoff chunks silently', async () => {
    assert.equal(
      await wire([
        { type: 'usage', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
        { type: 'tool-update', toolCall: { id: 'call-1' }, update: { pct: 50 } },
        { type: 'pending-client-tools', toolCalls: [{ id: 'c', name: 'geo', arguments: {} }] },
        { type: 'pending-approval', toolCall: { id: 'call-1' }, isClientTool: false },
        { type: 'handoff', handoff: { from: 'A', to: 'B' } },
      ]),
      '',
    )
  })
})

describe('toVercelDataStream — errors', () => {
  it('surfaces a throwing source stream to the reader', async () => {
    const stream = toVercelDataStream((async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text-delta', text: 'hi' }
      throw new Error('upstream exploded')
    })())
    const reader = stream.getReader()
    assert.deepEqual(await reader.read(), { done: false, value: new TextEncoder().encode('0:"hi"\n') })
    await assert.rejects(() => reader.read(), /upstream exploded/)
  })
})

describe('toVercelResponse', () => {
  it('sets the text/plain content type and the v1 data-stream header', async () => {
    const res = toVercelResponse(streamOf([{ type: 'text-delta', text: 'hi' }]))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(res.headers.get('x-vercel-ai-data-stream'), 'v1')
    assert.equal(await res.text(), '0:"hi"\n')
  })
})
