# @gemstack/connectors

## 0.1.0

### Minor Changes

- b0430f9: New package: the connector contract for GemStack AI orchestration. `defineConnector` declares a tool connector to an external service (its auth requirement + tools); `mountConnectors` composes any number into a single `@gemstack/mcp` server, namespacing tools by connector id and resolving credentials at call time. Built on `@gemstack/mcp`, framework-agnostic. First step of the connectors epic (GitHub, Google Drive to follow).
