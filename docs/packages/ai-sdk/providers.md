# Providers

`@gemstack/ai-sdk` is provider-agnostic. You write an agent once and switch between Anthropic, OpenAI, Google, and a dozen others by changing one model string. A provider is registered on a neutral registry, and every model reference is a `provider/model` string that the registry resolves to the right adapter.

This page is the full provider reference: how to register a provider, the config each one takes, the registry name it claims, the SDK peer to install, and which capabilities (chat, embeddings, rerank, image, TTS, STT) each provider actually implements.

See also: [Installation](/guide/installation), [Agents](/packages/ai-sdk/agents), [Testing & Evals](/packages/ai-sdk/testing).

## Registering a provider

Construct a provider with its config and hand it to `AiRegistry.register(...)`, then pick a default model with `AiRegistry.setDefault(...)`:

```ts
import { AiRegistry, AnthropicProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

Register as many providers as you use. Each claims its own registry name (the `name` field on the provider), and model strings route to it:

```ts
import { AiRegistry, AnthropicProvider, OpenAIProvider, OllamaProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.register(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }))
AiRegistry.register(new OllamaProvider({ baseUrl: 'http://localhost:11434/v1' }))

AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

Provider SDKs are optional peers, so you install only the SDK(s) for the providers you register. Each adapter lazy-loads its SDK on first call.

## Model strings are `provider/model`

Every model reference is `provider/model`. The part before the slash is the registry name; the part after is passed verbatim to that provider:

```ts
await agent('You are helpful.').prompt('Hi', { model: 'openai/gpt-4o' })
await agent('You are helpful.').prompt('Hi', { model: 'anthropic/claude-sonnet-4-6' })
```

A bare model name (`'claude-sonnet-4-6'`) throws. `AiRegistry.parseModelString(...)` is the splitter, and `AiRegistry.resolve(modelString)` returns the resolved adapter if you need it directly.

## Provider reference table

| Provider | Registry name | SDK peer | chat | embeddings | rerank | image | TTS | STT |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `AnthropicProvider` | `anthropic` | `@anthropic-ai/sdk` | yes | | | | | |
| `OpenAIProvider` | `openai` | `openai` | yes | yes | | yes | yes | yes |
| `GoogleProvider` | `google` | `@google/genai` | yes | yes | | yes | | |
| `OllamaProvider` | `ollama` | `openai` | yes | | | | | |
| `DeepSeekProvider` | `deepseek` | `openai` | yes | | | | | |
| `XaiProvider` | `xai` | `openai` | yes | | | | | |
| `GroqProvider` | `groq` | `openai` | yes | | | | | |
| `MistralProvider` | `mistral` | `openai` | yes | yes | | | | |
| `AzureOpenAIProvider` | `azure` | `openai` | yes | | | | | |
| `CohereProvider` | `cohere` | `cohere-ai` | | yes | yes | | | |
| `JinaProvider` | `jina` | none (HTTP) | | yes | yes | | | |
| `ElevenLabsProvider` | `elevenlabs` | none (HTTP) | | | | | yes | yes |
| `VoyageProvider` | `voyage` | none (HTTP) | | yes | yes | | | |
| `OpenRouterProvider` | `openrouter` | `openai` | yes | | | | | |
| `BedrockProvider` | `bedrock` | `@aws-sdk/client-bedrock-runtime` | yes | | | | | |

A blank cell means the provider does not implement that capability. Calling `create(...)` on a non-chat provider (Cohere, Jina, ElevenLabs, Voyage) throws with a message pointing you at the capabilities it does support.

"SDK peer: `openai`" means the provider speaks the OpenAI wire format and reuses the OpenAI adapter, so the `openai` package is the peer to install even though the service is not OpenAI.

## SDK peers to install

Install only the SDKs for the providers you register:

```bash
pnpm add @anthropic-ai/sdk              # Anthropic (Claude); also AWS Bedrock Claude
pnpm add openai                          # OpenAI, plus OpenRouter / Mistral / DeepSeek / Groq / xAI / Ollama / Azure
pnpm add @google/genai                   # Google (Gemini)
pnpm add cohere-ai                       # Cohere (reranking + embeddings)
pnpm add @aws-sdk/client-bedrock-runtime # AWS Bedrock
# ElevenLabs (TTS + STT)      - no extra package, direct HTTP
# VoyageAI (embeddings + rerank) - no extra package, direct HTTP
# Jina (embeddings + rerank)     - no extra package, direct HTTP
```

## Provider configs

Each provider takes a typed config object (its `*Config` type is exported alongside the class). Common shape: `apiKey` plus an optional `baseUrl` to point at a gateway or proxy.

### AnthropicProvider

```ts
import { AnthropicProvider, type AnthropicConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({
  apiKey:  process.env.ANTHROPIC_API_KEY!,
  baseUrl: undefined, // optional: override https://api.anthropic.com
}))
```

`AnthropicConfig`: `apiKey` (required), `baseUrl?`. Chat only.

### OpenAIProvider

```ts
import { OpenAIProvider, type OpenAIConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new OpenAIProvider({
  apiKey:  process.env.OPENAI_API_KEY!,
  baseUrl: undefined, // optional: override https://api.openai.com/v1
}))
```

`OpenAIConfig`: `apiKey` (required), `baseUrl?`. The widest provider: chat, embeddings, image generation, TTS, and STT. The exported `OpenAIAdapter` is the shared chat adapter that the OpenAI-compatible providers below reuse.

### GoogleProvider

```ts
import { GoogleProvider, type GoogleConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY! }))
```

`GoogleConfig`: `apiKey` (required). Chat, embeddings, image generation. Gemini's `cachedContent` resources are backed by `GoogleCacheRegistry` (also exported); construct it with your own `CacheAdapter` and pass it as the second constructor argument for cross-process cache persistence.

### OllamaProvider

```ts
import { OllamaProvider, type OllamaConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new OllamaProvider({ baseUrl: 'http://localhost:11434/v1' }))
```

`OllamaConfig`: `baseUrl?` (defaults to `http://localhost:11434/v1`). No API key. Speaks the OpenAI wire format, so the `openai` package is the peer. Chat only.

### DeepSeekProvider, XaiProvider, GroqProvider

All three are OpenAI-compatible chat providers with the same config shape:

```ts
import { DeepSeekProvider, XaiProvider, GroqProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }))
AiRegistry.register(new XaiProvider({ apiKey: process.env.XAI_API_KEY! }))
AiRegistry.register(new GroqProvider({ apiKey: process.env.GROQ_API_KEY! }))
```

Each config: `apiKey` (required), `baseUrl?`. Defaults: DeepSeek `https://api.deepseek.com/v1`, xAI `https://api.x.ai/v1`, Groq `https://api.groq.com/openai/v1`. Peer: `openai`. Chat only.

### MistralProvider

```ts
import { MistralProvider, type MistralConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new MistralProvider({ apiKey: process.env.MISTRAL_API_KEY! }))
```

`MistralConfig`: `apiKey` (required), `baseUrl?` (defaults to `https://api.mistral.ai/v1`). Chat (OpenAI-compatible, peer `openai`) plus embeddings.

### AzureOpenAIProvider

```ts
import { AzureOpenAIProvider, type AzureOpenAIConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new AzureOpenAIProvider({
  apiKey:  process.env.AZURE_OPENAI_API_KEY!,
  baseUrl: 'https://my-resource.openai.azure.com/openai/deployments/my-deployment',
}))
```

`AzureOpenAIConfig`: `apiKey` (required), `baseUrl` (required, your Azure deployment endpoint). Peer: `openai`. Chat.

### CohereProvider

```ts
import { CohereProvider, type CohereConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new CohereProvider({ apiKey: process.env.COHERE_API_KEY! }))
```

`CohereConfig`: `apiKey` (required). Embeddings and reranking only (no text generation). Peer: `cohere-ai`.

### JinaProvider

```ts
import { JinaProvider, type JinaConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new JinaProvider({ apiKey: process.env.JINA_API_KEY! }))
```

`JinaConfig`: `apiKey` (required). Embeddings and reranking only, over direct HTTP (no SDK peer).

### ElevenLabsProvider

```ts
import { ElevenLabsProvider, type ElevenLabsConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new ElevenLabsProvider({ apiKey: process.env.ELEVENLABS_API_KEY! }))
```

`ElevenLabsConfig`: `apiKey` (required), `baseUrl?` (override `https://api.elevenlabs.io`), `defaultTtsModelId?` (defaults to `eleven_multilingual_v2`). TTS and STT only, over direct HTTP. The exported `DEFAULT_TTS_MODEL_ID` and `DEFAULT_VOICE_ID` are the fallbacks.

### VoyageProvider

```ts
import { VoyageProvider, type VoyageConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new VoyageProvider({ apiKey: process.env.VOYAGE_API_KEY! }))
```

`VoyageConfig`: `apiKey` (required), `baseUrl?` (override `https://api.voyageai.com`), `defaultInputType?` (`'query'` | `'document'`, defaults to `'document'`). Best-in-class embeddings and reranking, over direct HTTP.

### OpenRouterProvider

```ts
import { OpenRouterProvider, type OpenRouterConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new OpenRouterProvider({
  apiKey:   process.env.OPENROUTER_API_KEY!,
  siteUrl:  'https://my-app.example',  // optional: sent as HTTP-Referer
  siteName: 'My App',                  // optional: sent as X-Title
}))
```

`OpenRouterConfig`: `apiKey` (required), `baseUrl?` (defaults to `https://openrouter.ai/api/v1`), `siteUrl?`, `siteName?`. OpenAI-compatible, peer `openai`. Chat.

### BedrockProvider

```ts
import { BedrockProvider, type BedrockConfig } from '@gemstack/ai-sdk'

AiRegistry.register(new BedrockProvider({ region: process.env.AWS_REGION ?? 'us-east-1' }))
```

`BedrockConfig`: `region` (required), `credentials?` (`{ accessKeyId, secretAccessKey, sessionToken? }`). Prefer the AWS credential chain (env vars, IAM roles) and leave `credentials` unset; set it only for explicit multi-account creds. Peer: `@aws-sdk/client-bedrock-runtime`. Chat; v1 supports Anthropic Claude models on Bedrock (model id starting with `anthropic.`).

## Gateways and proxies

Behind an LLM gateway or proxy? If it is OpenAI- or Anthropic-compatible, just set `baseUrl` on the matching provider and you are done:

```ts
AiRegistry.register(new OpenAIProvider({
  apiKey:  process.env.GATEWAY_KEY!,
  baseUrl: 'https://gateway.internal/openai/v1',
}))
```

If the gateway speaks its own wire format (its own auth scheme and request/response/SSE envelope), reach for the `@gemstack/ai-sdk/gateway` subpath and subclass `HttpGatewayAdapter`. It normalizes an upstream gateway behind the framework's `ProviderAdapter` contract:

```ts
import { HttpGatewayAdapter, type GatewayRequestContext } from '@gemstack/ai-sdk/gateway'

class AcmeGatewayAdapter extends HttpGatewayAdapter {
  // implement the abstract hooks: build the URL, headers, request body,
  // and parse the response / SSE stream into the framework's chunk shape.
}
```

The subpath also exports `GatewayAdapterConfig`, `GatewayRequestContext`, and `parseSseStream` (with its `SseEvent` type) for decoding a custom event stream. Wrap your adapter in a small `ProviderFactory` and register it like any other provider.

## See also

- [Installation](/guide/installation) - register providers and set the default model.
- [Vector Stores & RAG](/packages/ai-sdk/rag) - embeddings and reranking capabilities by provider.
- [Testing & Evals](/packages/ai-sdk/testing) - run agents against a fake instead of a real provider.
