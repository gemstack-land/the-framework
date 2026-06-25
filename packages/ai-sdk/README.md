# @gemstack/ai-sdk

AI engine: providers, agents, tools, streaming, middleware, structured output, conversation memory, evals, MCP, computer-use, and testing fakes.

The first [GemStack](https://gemstack.land) package. Spun out of Rudder's `@rudderjs/ai` (carried forward from the 1.17.x line, renamed and re-versioned under the GemStack umbrella). The Rudder package now ships as a thin deprecated re-export of this one.

## Installation

```bash
pnpm add @gemstack/ai-sdk
```

Install the provider SDK(s) you need:

```bash
pnpm add @anthropic-ai/sdk             # Anthropic (Claude)
pnpm add openai                         # OpenAI (GPT), also used for OpenRouter / Mistral / DeepSeek / Groq / xAI / Ollama
pnpm add @google/genai                  # Google (Gemini)
pnpm add cohere-ai                      # Cohere (reranking + embeddings)
pnpm add @aws-sdk/client-bedrock-runtime # AWS Bedrock
# ElevenLabs (premium TTS + STT)        - no extra package needed (direct HTTP)
# VoyageAI (embeddings + reranking)     - no extra package needed (direct HTTP)
# Jina                                   - no extra package needed (direct HTTP)
```

## Status

`@gemstack/ai-sdk` starts at `0.1.0`. The code is mature, but the version line is intentionally reset: the public surface is being decoupled from Rudder (the `@rudderjs/core` / `@rudderjs/orm` coupling and the ORM-backed subpaths are moving behind a neutral, optional adapter seam) so the package stands alone in any Node app. Expect the API to firm up toward `1.0.0` as that decoupling lands.

## Subpath exports

| Subpath | What it provides |
|---|---|
| `.` | Core: `Agent`, `tool`, streaming, middleware, facade |
| `./server` | The server provider entry |
| `./node` | Node-only entry |
| `./mcp` | Model Context Protocol server/client helpers |
| `./computer-use` | Computer-use tool + executor |
| `./eval` | Eval framework (`evalSuite`, metrics, reporters) |
| `./gateway` | Gateway helpers |
| `./conversation-orm`, `./memory-orm`, `./budget-orm` | ORM-backed stores (optional `@rudderjs/orm` peer; moving behind the neutral seam) |
| `./memory-embedding` | Embedding-backed user memory |
| `./react` | React bindings |

## License

MIT
