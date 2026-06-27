# @gemstack/ai-sdk

`@gemstack/ai-sdk` is a provider-agnostic agent runtime. Define an agent once, then swap between Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Bedrock, and others by changing one model string. The engine handles tool calling, streaming, middleware hooks, structured output, multi-modal attachments, sub-agents, conversation memory, and a test fake. Its only required runtime dependency is `zod`; provider SDKs are optional peers you install per provider.

```ts
import { AiRegistry, AnthropicProvider, agent } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.setDefault('anthropic/claude-sonnet-4-6')

const response = await agent('You are a helpful assistant.')
  .prompt('Summarize the transformer architecture in one sentence.')

console.log(response.text)
```

Models are always `provider/model`; a bare model name throws. See [/guide/installation](/guide/installation) for setup and [/guide/first-agent](/guide/first-agent) for a full walkthrough.

## Subpath exports

The engine works in any `fetch`-capable JS runtime (Node, browser, Electron, React Native): the main entry has zero static `node:*` imports.

| Subpath | What it provides |
|---|---|
| `.` | Core: `Agent`, `agent()`, `AI`, tools, streaming, providers, middleware, structured output, run stores, testing fake |
| `./node` | Node-only filesystem helpers for attachments |
| `./observers` | Observer registry (`aiObservers`) for run telemetry |
| `./chat-mentions` | `@slug` agent routing helpers (`parseMentions`, `buildMentionRoutingRule`) |
| `./gateway` | Custom LLM-gateway / proxy adapter helpers |
| `./eval` | Eval framework (`evalSuite`, metrics, reporters) |
| `./computer-use` | Computer-use tool + executor |
| `./react` | React client bindings (`useAgentRun`) |

The MCP bridge moved out to its own package, [/packages/ai-mcp](/packages/ai-mcp).

## What's in the box

- [Running agents](/packages/ai-sdk/agents) - the three agent shapes, multi-step loops, sub-agents, suspend/resume, queued prompts, and middleware.
- [Tools](/packages/ai-sdk/tools) - `toolDefinition().server()`, scoped (multi-capability) tools, client tools, approval gates, and parallel execution.
- [Streaming](/packages/ai-sdk/streaming) - chunk iteration, Server-Sent Events, and the Vercel AI SDK adapter.
- [Structured output](/packages/ai-sdk/structured-output) - typed, schema-validated responses.
- [Memory](/packages/ai-sdk/memory) - conversation persistence and cross-thread user memory behind neutral contracts.
- [RAG](/packages/ai-sdk/rag) - hosted vector stores and `fileSearch` retrieval.
- [Providers](/packages/ai-sdk/providers) - the provider catalog and per-provider configuration.
- [Testing](/packages/ai-sdk/testing) - the `AiFake` programmable mock and the eval harness.

For higher-level orchestration built on this runtime, see [/packages/ai-autopilot](/packages/ai-autopilot); for Model Context Protocol bridging, see [/packages/ai-mcp](/packages/ai-mcp).

## Where this came from

`@gemstack/ai-sdk` is the engine spun out of Rudder's `@rudderjs/ai` (carried forward from the 1.17.x line, renamed and re-versioned under the [GemStack](/packages/) umbrella). `@rudderjs/ai` now re-exports this engine and adds the Rudder-specific bindings on top (the framework service provider, ORM-backed stores, and the `make:agent` / `ai:eval` CLI). Those bindings are not part of this package: everything documented here is what `@gemstack/ai-sdk` itself exports, usable with no framework.
