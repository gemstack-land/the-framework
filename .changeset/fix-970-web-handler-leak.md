---
'@gemstack/mcp': minor
---

fix(mcp): stop the web handler attaching an SDK per unauthenticated POST

`createWebRequestHandler` built a transport + SDK pair and called `attachSdk` for any POST without a known `mcp-session-id`, not just an `initialize`. Nothing ever detached those pairs, so the server's notification set grew by one entry per unauthenticated request. Only an `initialize` opens a session now; anything else is answered `400`/`404` per the streamable-HTTP spec without allocating. A pair that ends up with no registered session (rejected initialize, failed connect) is always released.

Also: stateful sessions now expire after 30 minutes idle (`sessionIdleMs`), both handlers expose `close()` to tear every live session down, and stateless mode builds one transport per request (the SDK rejects a reused stateless transport) instead of sharing one racily created pair.
