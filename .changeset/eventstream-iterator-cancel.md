---
'@gemstack/ai-autopilot': patch
---

fix(ai-autopilot): EventStream iterators are now cancellable

A consumer's async iterator gained a `return()` that drops its waiter from the stream and settles any pending `next()`. Previously a consumer that stopped iterating (e.g. a disconnected SSE client) left its waiter registered until the next `push`/`close`, so many short-lived consumers on an idle stream leaked. Live iteration and history replay are unchanged.
