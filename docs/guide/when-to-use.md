# When to Use GemStack

GemStack is a set of standalone, framework-agnostic packages for building AI applications in Node. This page is about fit: what GemStack is good at, where it deliberately stops, and how it differs from the tools you might reach for instead.

## Reach for GemStack when

- **You want a provider-agnostic agent runtime, not a provider SDK.** Define an agent once and swap Anthropic, OpenAI, Google, Ollama, and others by changing one model string. The tool loop, streaming, structured output, middleware, and a test fake come with it.
- **You are building on the server, in any stack.** GemStack is UI-agnostic and framework-agnostic. It runs in any `fetch`-capable runtime and ships no React/Vue/Svelte coupling, so it drops into an existing Express, Hono, Fastify, Nitro, or Rudder app without taking it over.
- **You need production concerns as first-class APIs.** Conversation persistence, cross-conversation user memory, token/cost budgets, prompt caching, sub-agent streaming with mid-run suspend, and an eval harness are part of the runtime, behind neutral contracts you implement against your own infrastructure.
- **You care about testing.** A full fake (`AiFake`) lets you assert on prompts, tool calls, and every modality without hitting a real model or spending a token.
- **You are working with MCP from either side.** Bridge an agent to remote MCP servers, expose an agent as a server, or author a standalone MCP server, all with first-party packages.

## Look elsewhere when

- **You want a batteries-included frontend chat UI.** GemStack is a server runtime. It speaks the Vercel AI protocol (`toVercelResponse()`), so a frontend chat library can consume its stream, but it ships no `useChat`-style hooks of its own.
- **You only ever call one provider and want its native SDK.** If you are committed to a single vendor and want every bleeding-edge feature the day it ships, that vendor's own SDK will always be a release ahead of any abstraction.
- **You want a hosted platform.** GemStack is libraries you run, not a managed service with a dashboard and billing.

## How it differs from the usual suspects

| | GemStack | A provider SDK (e.g. one vendor's client) | A heavyweight agent framework |
|---|---|---|---|
| **Scope** | Agent runtime + skills + orchestration + MCP, as separate packages | One provider's API surface | Large, opinionated, many abstractions |
| **Providers** | Many, swap by model string | One | Many, via adapters |
| **Coupling** | Framework-agnostic, server-side, `zod` is the only hard dependency | None, but vendor-locked | Often heavy dependency graph |
| **Persistence** | Neutral contracts you implement (BYO database / cache / store) | None | Often bundled and opinionated |
| **Adopt incrementally** | Yes, take one package | N/A | Usually all-or-nothing |

The point is not that GemStack does the most. It is that each package does one thing, stays framework-agnostic, and composes with the others, so you can adopt a single piece without buying into a platform.

## Next

- [Installation](/guide/installation) - get the runtime and a provider running.
- [Your First Agent](/guide/first-agent) - the smallest end-to-end example.
- [Build a Multi-Agent App](/guide/tutorial) - compose tools, skills, and a supervisor.
- [Packages overview](/packages/) - the whole family and how the pieces fit.
