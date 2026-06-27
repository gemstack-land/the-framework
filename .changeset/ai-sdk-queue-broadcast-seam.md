---
"@gemstack/ai-sdk": minor
---

Make `agent.queue()` / `.broadcast()` framework-agnostic. The engine no longer dynamically imports `@rudderjs/queue` or `@rudderjs/broadcast`; instead register a neutral adapter once at startup with the new `configureAiQueue({ dispatch, broadcast })`. New public exports: `configureAiQueue`, and the `QueueDispatch` / `QueueBroadcast` types. Rudder users get this wired automatically by `@rudderjs/ai`'s provider (no app change). This removes the last `@rudderjs/*` reference from the engine source.
