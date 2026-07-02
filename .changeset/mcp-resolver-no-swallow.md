---
'@gemstack/mcp': minor
---

`resolveOrConstruct` no longer masks a genuine resolver failure with an un-wired instance.

`McpResolver` gains an optional `has?(token)` hook. When a resolver implements it (the built-in `createResolver` now does), the runtime only routes tokens it owns through `resolve()` when constructing a primitive class, and lets a genuine construction failure (e.g. a missing constructor dependency) propagate loudly instead of silently falling back to `new Token()`. Resolvers without `has` keep the previous behavior — a `resolve` miss (throw or `undefined`) falls back to a plain constructor — so this is backward compatible.
