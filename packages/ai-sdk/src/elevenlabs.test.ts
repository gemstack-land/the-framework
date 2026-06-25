/**
 * ElevenLabs provider tests (#B9).
 *
 * Mocks `globalThis.fetch` to capture request shape and stub responses.
 * Verifies:
 *  - `create()` throws (no chat completions on this provider).
 *  - TTS request: URL voice-id substitution, headers (xi-api-key, Content-Type),
 *    body (text + model_id), `output_format` query param mapping (mp3, opus,
 *    unsupported throws).
 *  - TTS response decode: arrayBuffer → Buffer; format + model passthrough.
 *  - STT request: multipart form (file + model_id + optional language_code),
 *    xi-api-key header (no Content-Type — let fetch set the multipart boundary).
 *  - STT response decode: text / language / duration (last word's `end`).
 *  - Error responses surface readable messages with the HTTP status.
 *  - `voice` opt overrides the model-string voice id.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { ElevenLabsProvider } from './providers/elevenlabs.js'

interface FetchCall {
  url:    string
  method: string
  headers: Record<string, string>
  body:   unknown
}

let fetchCalls: FetchCall[] = []
let nextResponse: Response | undefined
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis)

beforeEach(() => {
  fetchCalls   = []
  nextResponse = undefined
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url     = typeof input === 'string' ? input : (input as { toString(): string }).toString()
    const method  = init?.method ?? 'GET'
    const headers = headersToObject(init?.headers)
    fetchCalls.push({ url, method, headers, body: init?.body })
    if (!nextResponse) throw new Error(`unmocked fetch: ${method} ${url}`)
    return nextResponse
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

function stubAudio(bytes: Uint8Array, status = 200): void {
  nextResponse = new Response(bytes, { status, headers: { 'Content-Type': 'audio/mpeg' } })
}

function stubJson(body: unknown, status = 200): void {
  nextResponse = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubError(status: number, body: string): void {
  nextResponse = new Response(body, { status })
}

function headersToObject(h: unknown): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => { out[k] = v })
    return out
  }
  if (Array.isArray(h)) return Object.fromEntries(h as Array<[string, string]>)
  return { ...h as Record<string, string> }
}

// ─── Provider shape ──────────────────────────────────────

describe('ElevenLabsProvider', () => {
  it('create() throws — no chat completions surface', () => {
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    assert.throws(() => p.create('any-model'), /does not support text generation/)
  })

  it('createTts() returns a TextToSpeechAdapter', () => {
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    const a = p.createTts('voice_abc')
    assert.equal(typeof a.generate, 'function')
  })

  it('createStt() returns a SpeechToTextAdapter', () => {
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    const a = p.createStt('scribe_v1')
    assert.equal(typeof a.transcribe, 'function')
  })
})

// ─── TTS request shape ───────────────────────────────────

describe('ElevenLabs TTS — generate()', () => {
  it('hits /v1/text-to-speech/{voice_id} with xi-api-key + JSON body', async () => {
    stubAudio(new Uint8Array([1, 2, 3, 4]))
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    const a = p.createTts('21m00Tcm4TlvDq8ikWAM')
    const r = await a.generate({ text: 'Hello world' })

    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]!
    assert.match(call.url, /\/v1\/text-to-speech\/21m00Tcm4TlvDq8ikWAM/)
    assert.match(call.url, /output_format=mp3_44100_128/)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['xi-api-key'],   'sk-test')
    assert.equal(call.headers['Content-Type'], 'application/json')
    assert.equal(call.headers['Accept'],       'audio/mpeg')
    assert.deepEqual(JSON.parse(call.body as string), {
      text:     'Hello world',
      model_id: 'eleven_multilingual_v2',
    })

    assert.ok(Buffer.isBuffer(r.audio))
    assert.deepEqual(Array.from(r.audio), [1, 2, 3, 4])
    assert.equal(r.format, 'mp3')
    assert.equal(r.model,  '21m00Tcm4TlvDq8ikWAM')
  })

  it('honors per-call voice override', async () => {
    stubAudio(new Uint8Array([0]))
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    await p.createTts('default_voice').generate({ text: 'x', voice: 'override_voice' })

    assert.match(fetchCalls[0]!.url, /\/v1\/text-to-speech\/override_voice/)
    // The result.model reflects the actual voice used.
  })

  it('honors defaultTtsModelId override', async () => {
    stubAudio(new Uint8Array([0]))
    const p = new ElevenLabsProvider({ apiKey: 'sk-test', defaultTtsModelId: 'eleven_turbo_v2_5' })
    await p.createTts('voice_x').generate({ text: 'x' })

    assert.equal(JSON.parse(fetchCalls[0]!.body as string).model_id, 'eleven_turbo_v2_5')
  })

  it('maps format mp3 → mp3_44100_128', async () => {
    stubAudio(new Uint8Array([0]))
    await new ElevenLabsProvider({ apiKey: 'sk-test' }).createTts('v').generate({ text: 'x', format: 'mp3' })
    assert.match(fetchCalls[0]!.url, /output_format=mp3_44100_128/)
  })

  it('maps format opus → opus_48000_128 + Accept audio/opus', async () => {
    stubAudio(new Uint8Array([0]))
    await new ElevenLabsProvider({ apiKey: 'sk-test' }).createTts('v').generate({ text: 'x', format: 'opus' })
    assert.match(fetchCalls[0]!.url, /output_format=opus_48000_128/)
    assert.equal(fetchCalls[0]!.headers['Accept'], 'audio/opus')
  })

  for (const unsupported of ['wav', 'aac', 'flac'] as const) {
    it(`throws clearly for unsupported format '${unsupported}'`, async () => {
      const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
      await assert.rejects(
        p.createTts('v').generate({ text: 'x', format: unsupported }),
        new RegExp(`does not support format '${unsupported}'`),
      )
      // Crucially: never even called fetch.
      assert.equal(fetchCalls.length, 0)
    })
  }

  it('honors baseUrl override', async () => {
    stubAudio(new Uint8Array([0]))
    const p = new ElevenLabsProvider({ apiKey: 'sk-test', baseUrl: 'https://gateway.example.com' })
    await p.createTts('v').generate({ text: 'x' })
    assert.match(fetchCalls[0]!.url, /^https:\/\/gateway\.example\.com\/v1\/text-to-speech\/v\?/)
  })

  it('surfaces non-2xx errors with status + body', async () => {
    stubError(401, 'Unauthorized — bad API key')
    const p = new ElevenLabsProvider({ apiKey: 'sk-bad' })
    await assert.rejects(
      p.createTts('v').generate({ text: 'x' }),
      /TTS failed \(401\): Unauthorized — bad API key/,
    )
  })

  it('encodes voice ids with special chars safely', async () => {
    stubAudio(new Uint8Array([0]))
    // Hypothetical voice id with characters that need URL-encoding.
    await new ElevenLabsProvider({ apiKey: 'sk-test' })
      .createTts('voice with spaces & symbols')
      .generate({ text: 'x' })
    assert.match(fetchCalls[0]!.url, /voice%20with%20spaces%20%26%20symbols/)
  })
})

// ─── STT request shape ───────────────────────────────────

describe('ElevenLabs STT — transcribe()', () => {
  it('posts multipart with file + model_id; returns text + language + duration', async () => {
    stubJson({
      text:           'Hello world.',
      language_code:  'en',
      words: [
        { text: 'Hello', start: 0,    end: 0.5 },
        { text: 'world', start: 0.6,  end: 1.2 },
      ],
    })
    const p = new ElevenLabsProvider({ apiKey: 'sk-test' })
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44])
    const r = await p.createStt('scribe_v1').transcribe({ audio })

    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]!
    assert.match(call.url, /\/v1\/speech-to-text$/)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['xi-api-key'], 'sk-test')
    // Crucially: NO Content-Type set — fetch must add the multipart
    // boundary itself. Verifying absence:
    assert.equal(call.headers['Content-Type'], undefined)

    // Body must be FormData.
    assert.ok(call.body instanceof FormData)
    const form = call.body
    assert.equal(form.get('model_id'), 'scribe_v1')
    assert.equal(form.get('language_code'), null) // not provided this run
    const file = form.get('file')
    assert.ok(file instanceof Blob)

    assert.equal(r.text,     'Hello world.')
    assert.equal(r.language, 'en')
    assert.equal(r.duration, 1.2)
    assert.equal(r.model,    'scribe_v1')
  })

  it('forwards optional language_code', async () => {
    stubJson({ text: 'Bonjour' })
    await new ElevenLabsProvider({ apiKey: 'sk-test' })
      .createStt('scribe_v1')
      .transcribe({ audio: new Uint8Array([0]), language: 'fr' })
    const form = fetchCalls[0]!.body as FormData
    assert.equal(form.get('language_code'), 'fr')
  })

  it('omits language + duration from the result when ElevenLabs omits them', async () => {
    stubJson({ text: 'just text' })
    const r = await new ElevenLabsProvider({ apiKey: 'sk-test' })
      .createStt('scribe_v1')
      .transcribe({ audio: new Uint8Array([0]) })
    assert.equal(r.text,     'just text')
    assert.equal(r.language, undefined)
    assert.equal(r.duration, undefined)
  })

  it('handles Buffer audio input', async () => {
    stubJson({ text: 'ok' })
    const buf = Buffer.from([1, 2, 3])
    await new ElevenLabsProvider({ apiKey: 'sk-test' })
      .createStt('scribe_v1')
      .transcribe({ audio: buf })
    const form = fetchCalls[0]!.body as FormData
    const file = form.get('file') as Blob
    assert.equal(file.size, 3)
  })

  it('surfaces non-2xx errors with status + body', async () => {
    stubError(429, 'Rate limit exceeded')
    await assert.rejects(
      new ElevenLabsProvider({ apiKey: 'sk-test' })
        .createStt('scribe_v1')
        .transcribe({ audio: new Uint8Array([0]) }),
      /STT failed \(429\): Rate limit exceeded/,
    )
  })

  it('honors baseUrl override', async () => {
    stubJson({ text: 'ok' })
    await new ElevenLabsProvider({ apiKey: 'sk-test', baseUrl: 'https://gateway.example.com' })
      .createStt('scribe_v1')
      .transcribe({ audio: new Uint8Array([0]) })
    assert.match(fetchCalls[0]!.url, /^https:\/\/gateway\.example\.com\/v1\/speech-to-text$/)
  })
})
