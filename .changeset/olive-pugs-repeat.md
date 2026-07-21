---
'@gemstack/ai-sdk': patch
---

Fix four provider protocol defects found in the AI package sweep.

- Google prompt caching dropped the system instruction and every tool declaration from the request even when the cache markers had not cached them, so a marker set like `{ messages: 2 }` silently sent neither.
- Google streaming derived its finish reason from Gemini's raw value. Gemini reports `STOP` for a function-call turn, so a streamed tool call ended the run instead of returning the tool results to the model, while a `SAFETY` or `MAX_TOKENS` stop claimed tool calls existed and kept the loop running.
- Anthropic joined `ContentPart[]` system content with `Array.prototype.join`, sending `[object Object]` as the system prompt.
- OpenAI never set `stream_options: { include_usage: true }` and discarded the trailing usage chunk, so every streamed call reported no token usage to budget accounting. Truncation and content-filter stops now map to `length` and `content_filter` instead of a clean `stop`.
