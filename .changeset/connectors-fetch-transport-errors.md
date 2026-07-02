---
'@gemstack/mcp-connector-github': patch
'@gemstack/mcp-connector-google-drive': patch
---

Wrap transport failures in the connector's typed error class.

The clients only wrapped non-2xx responses in `GitHubError`/`GoogleDriveError`; a `fetch()` rejection (DNS failure, timeout, offline) escaped as a raw `TypeError`. Each `fetch` call site now rethrows transport failures as the connector's error type with `status: 0`, so all failures surface through one typed class.
