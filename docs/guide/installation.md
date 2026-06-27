# Installation

The agent runtime lives in [`@gemstack/ai-sdk`](/packages/ai-sdk/). Install it plus the provider SDK(s) you actually use - provider SDKs are optional peers, and each adapter lazy-loads its SDK on first call.

```bash
pnpm add @gemstack/ai-sdk

pnpm add @anthropic-ai/sdk               # Anthropic (Claude)
pnpm add openai                          # OpenAI (also Azure / OpenRouter / Mistral / DeepSeek / Groq / xAI / Ollama)
pnpm add @google/genai                   # Google (Gemini)
pnpm add cohere-ai                       # Cohere (reranking + embeddings)
pnpm add @aws-sdk/client-bedrock-runtime # AWS Bedrock
# ElevenLabs, Voyage, Jina - no extra package needed (direct HTTP)
```

The core stands alone: `@gemstack/ai-sdk`'s only required runtime dependency is `zod`.

## Configure a provider

Register the providers you want and set a default model. Each provider's `name` (e.g. `anthropic`) becomes the registry key, and model strings are always `provider/model`.

```ts
import { AiRegistry, AnthropicProvider, OpenAIProvider, OllamaProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.register(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }))
AiRegistry.register(new OllamaProvider({ baseUrl: 'http://localhost:11434/v1' }))

AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

Run this once at startup (an `ai.ts` module you import early, for example). Models are always `provider/model` - a bare model name throws. See [Providers](/packages/ai-sdk/providers) for every adapter and its config.

> Behind an LLM gateway or proxy? If it is OpenAI- or Anthropic-compatible, set `baseUrl` on the matching provider. If it speaks its own wire format, subclass the gateway adapter from the `@gemstack/ai-sdk/gateway` subpath.

## Runtime compatibility

`@gemstack/ai-sdk` works in any `fetch`-capable JS runtime - Node, browser, Electron (main and renderer), React Native. The main entry has zero static `node:*` imports.

| Import | Runtimes | What's inside |
|---|---|---|
| `@gemstack/ai-sdk` | Node, browser, RN, Electron | Agents, tools, streaming, providers, attachments, structured output |
| `@gemstack/ai-sdk/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` filesystem helpers |
| `@gemstack/ai-sdk/react` | Browser | React bindings (`useAgentRun`) |
| `@gemstack/ai-sdk/eval` | Node | Eval framework (`evalSuite`, metrics, reporters) |
| `@gemstack/ai-sdk/computer-use` | Node | Computer-use tool + executor |

In a client runtime, use byte-based factories instead of filesystem paths:

```ts
import { Image } from '@gemstack/ai-sdk'

const img = Image.fromBase64(cameraBase64, 'image/jpeg')
const url = await Image.fromUrl('https://example.com/photo.jpg')
```

> Calling LLM providers directly from a browser or React Native client leaks your API key - use a server-side proxy in production. The main client-side use case is BYOK desktop apps.

## Next

- [Your First Agent](/guide/first-agent) - define and run an agent.
- [Packages overview](/packages/) - the whole GemStack family.
