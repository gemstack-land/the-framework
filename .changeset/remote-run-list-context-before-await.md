---
"@gemstack/framework": patch
---

Fix a remote run vanishing from the session list on a dashboard reload ("This session is gone"). `onRuns` read the relayed-run stubs through `contextRemote()` after two awaits, but telefunc only exposes `getContext()` synchronously at the top of a telefunction, so the call threw and every remote run was silently dropped from the list. The context is now read before the first await, so a relayed run stays in the list and re-opens after a reload as #1077 intended.
