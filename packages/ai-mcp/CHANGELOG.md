# @gemstack/ai-mcp

## 0.1.0

### Minor Changes

- 9da9b29: Initial release. The agent<->MCP bridge, carved out of `@gemstack/ai-sdk`'s former `./mcp` subpath:

  - `mcpClientTools(transport, opts?)` — consume a remote MCP server's tools as `@gemstack/ai-sdk` Agent tools (HTTP URL / stdio spawn / connected SDK client).
  - `mcpServerFromAgent(AgentClass, opts?)` — expose an Agent as an MCP server, with `'tools'` / `'agent'` / `'both'` exposure modes.

  Depends on `@gemstack/ai-sdk`; `@modelcontextprotocol/sdk` is an optional peer.

### Patch Changes

- Updated dependencies [9da9b29]
  - @gemstack/ai-sdk@0.3.0
