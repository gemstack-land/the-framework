# connectors-quickstart

A runnable reference connector built with [`@gemstack/mcp-connectors`](../../packages/mcp-connectors). Copy `src/library-connector.ts` to start a real connector: swap the in-memory data for calls to your external service, and change `auth` from `none` to `pat` / `oauth`.

```bash
pnpm --filter @gemstack/example-connectors-quickstart start   # run the demo
pnpm --filter @gemstack/example-connectors-quickstart test    # run the smoke test
```

What it shows:

- `defineConnector(...)` — one read-only connector (`library`) with three tools.
- `mountConnectors([library], { credentials })` — composing it into a standard `@gemstack/mcp` server, with the credential seam wired.
- Driving it through `McpTestClient` — `listTools()` shows tools namespaced as `library_*`, `callTool(...)` runs them.
