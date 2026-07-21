import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { OpenAIAdapter } from './openai/chat.js'
import { OpenAIFileAdapter } from './openai/files.js'
import { OpenAIImageAdapter } from './openai/images.js'
import { OpenAISttAdapter } from './openai/stt.js'
import { OpenAITtsAdapter } from './openai/tts.js'
import { OpenAIVectorStoreAdapter } from './openai/vector-store.js'
import type { OpenAIConfig } from './openai/config.js'

import { GoogleAdapter } from './google/chat.js'
import { GoogleEmbeddingAdapter } from './google/embeddings.js'
import { GoogleFileAdapter } from './google/files.js'
import { GoogleVectorStoreAdapter } from './google/vector-store.js'
import type { GoogleConfig } from './google/config.js'

/**
 * The client-construction path is otherwise untested: every other suite
 * pre-sets `client` so `getClient()` short-circuits. These drive the real
 * lazy import so a shared helper cannot silently drop a config field.
 */

/** `getClient()` is private; the tests are the only callers that need it. */
function getClient(adapter: unknown): Promise<any> {
  return (adapter as { getClient(): Promise<any> }).getClient()
}

const openAiAdapters: ReadonlyArray<[string, (c: OpenAIConfig) => unknown]> = [
  ['OpenAIAdapter', c => new OpenAIAdapter(c, 'gpt-4o')],
  ['OpenAIFileAdapter', c => new OpenAIFileAdapter(c)],
  ['OpenAIImageAdapter', c => new OpenAIImageAdapter(c, 'gpt-image-1')],
  ['OpenAISttAdapter', c => new OpenAISttAdapter(c, 'whisper-1')],
  ['OpenAITtsAdapter', c => new OpenAITtsAdapter(c, 'tts-1')],
  ['OpenAIVectorStoreAdapter', c => new OpenAIVectorStoreAdapter(c)],
]

const googleAdapters: ReadonlyArray<[string, (c: GoogleConfig) => unknown]> = [
  ['GoogleAdapter', c => new GoogleAdapter(c, 'gemini-2.0-flash')],
  ['GoogleEmbeddingAdapter', c => new GoogleEmbeddingAdapter(c, 'text-embedding-004')],
  ['GoogleFileAdapter', c => new GoogleFileAdapter(c)],
  ['GoogleVectorStoreAdapter', c => new GoogleVectorStoreAdapter(c)],
]

describe('OpenAI adapters — client construction', () => {
  for (const [name, make] of openAiAdapters) {
    it(`${name} forwards every configured field to the SDK`, async () => {
      const client = await getClient(
        make({
          apiKey: 'sk-test',
          baseUrl: 'https://proxy.example/v1',
          organization: 'org-test',
          defaultHeaders: { 'X-Trace': 'on' },
        }),
      )

      assert.equal(client.apiKey, 'sk-test')
      assert.equal(client.baseURL, 'https://proxy.example/v1')
      assert.equal(client.organization, 'org-test')
      assert.deepEqual(client._options.defaultHeaders, { 'X-Trace': 'on' })
    })

    it(`${name} leaves the SDK defaults alone when only apiKey is set`, async () => {
      const client = await getClient(make({ apiKey: 'sk-test' }))

      assert.equal(client.apiKey, 'sk-test')
      assert.equal(client.baseURL, 'https://api.openai.com/v1')
      assert.equal(client.organization, null)
      assert.equal(client._options.defaultHeaders, undefined)
    })

    it(`${name} builds the client once and memoises it`, async () => {
      const adapter = make({ apiKey: 'sk-test' })

      assert.equal(await getClient(adapter), await getClient(adapter))
    })
  }
})

describe('Google adapters — client construction', () => {
  for (const [name, make] of googleAdapters) {
    it(`${name} forwards the api key to the SDK`, async () => {
      const client = await getClient(make({ apiKey: 'gk-test' }))

      assert.equal(client.apiKey, 'gk-test')
      assert.equal(client.vertexai, false)
    })

    it(`${name} builds the client once and memoises it`, async () => {
      const adapter = make({ apiKey: 'gk-test' })

      assert.equal(await getClient(adapter), await getClient(adapter))
    })
  }
})
