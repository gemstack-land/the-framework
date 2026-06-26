---
"@gemstack/mcp": minor
---

Promote MCP-authoring utilities to the public API so inspectors and tooling no longer need internal access.

- `McpServer.introspect()`: a public introspection surface returning the registered tool / resource / prompt classes (constructors, not instances) without starting a session. The supported alternative to the internal `_tools()` / `_resources()` / `_prompts()` accessors, which stay `@internal`.
- `zodToJsonSchema(schema)`: convert a Zod schema to the JSON Schema MCP advertises (exported from the package entry).
- `matchUriTemplate(template, uri)`: match a URI against a `resource://{template}` pattern and extract params.
- New `McpServerIntrospection` and `ZodLikeObject` types exported alongside.

This lets a thin framework binding (e.g. `@rudderjs/mcp`) build a server inspector against the published surface instead of re-declaring internal shapes or carrying local copies of the helpers.
