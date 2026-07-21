---
'@gemstack/ai-sdk': patch
---

Internal: the provider layer no longer carries four copies of the same code. Every adapter builds its SDK client through one shared `lazyClient()` helper, the five pure OpenAI-compatible providers (`xai`, `groq`, `deepseek`, `ollama`, `azure`) come from one factory, and the Anthropic stream-event mapping is shared with Bedrock instead of being inlined twice.

Two side effects worth naming. A first client build is now memoised as a promise, so two concurrent calls share one client rather than racing to construct two, and a failed dynamic import no longer caches. And `XaiProvider.name` and friends are typed `string` rather than the literal `'xai'`, matching the `ProviderFactory` contract they are consumed through.

All public exports keep their names, constructor signatures, and default base URLs.
