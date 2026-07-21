import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { XaiProvider } from './providers/xai.js'
import { GroqProvider } from './providers/groq.js'
import { DeepSeekProvider } from './providers/deepseek.js'
import { OllamaProvider } from './providers/ollama.js'
import { AzureOpenAIProvider } from './providers/azure.js'
import type { ProviderAdapter } from './types.js'
import type { OpenAIConfig } from './providers/openai/config.js'

/** The adapter keeps its resolved config privately; read it to assert wiring. */
function resolved(adapter: ProviderAdapter): OpenAIConfig {
  return (adapter as unknown as { config: OpenAIConfig }).config
}

describe('OpenAI-compatible providers', () => {
  const cases = [
    { name: 'xai', make: () => new XaiProvider({ apiKey: 'k' }), baseUrl: 'https://api.x.ai/v1' },
    { name: 'groq', make: () => new GroqProvider({ apiKey: 'k' }), baseUrl: 'https://api.groq.com/openai/v1' },
    { name: 'deepseek', make: () => new DeepSeekProvider({ apiKey: 'k' }), baseUrl: 'https://api.deepseek.com/v1' },
    { name: 'ollama', make: () => new OllamaProvider(), baseUrl: 'http://localhost:11434/v1' },
  ]

  for (const c of cases) {
    it(`${c.name} reports its name and defaults its base URL`, () => {
      const provider = c.make()
      assert.equal(provider.name, c.name)
      assert.equal(resolved(provider.create('some-model')).baseUrl, c.baseUrl)
    })
  }

  it('an explicit baseUrl wins over the default', () => {
    const adapter = new GroqProvider({ apiKey: 'k', baseUrl: 'http://proxy.local/v1' }).create('m')
    assert.equal(resolved(adapter).baseUrl, 'http://proxy.local/v1')
  })

  it('forwards the api key', () => {
    assert.equal(resolved(new XaiProvider({ apiKey: 'sk-xai' }).create('m')).apiKey, 'sk-xai')
  })

  it('ollama substitutes a placeholder key the SDK will accept', () => {
    assert.equal(resolved(new OllamaProvider().create('llama3')).apiKey, 'ollama')
  })

  it('azure uses the caller endpoint verbatim, with no default', () => {
    const endpoint = 'https://my-resource.openai.azure.com/openai/deployments/my-deployment'
    const adapter = new AzureOpenAIProvider({ apiKey: 'k', baseUrl: endpoint }).create('gpt-4o')
    assert.equal(resolved(adapter).baseUrl, endpoint)
  })
})
