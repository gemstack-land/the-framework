---
'@gemstack/connectors': patch
---

Aggregate each connector's `instructions` into the mounted server's metadata.

`mountConnectors` previously read only the server-level `instructions` option and ignored `Connector.instructions`, so per-connector instructions set by `defineConnector` were silently dropped. They are now composed into the server instructions: the server-level text first, then each connector's text under a heading named after the connector.
