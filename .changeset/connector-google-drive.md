---
"@gemstack/connector-google-drive": minor
---

New package: the Google Drive connector for GemStack AI orchestration. Browse, read, and share Drive files over the Drive REST API (v3) — `get-about`, `list-files`, `search-files`, `get-file`, `get-file-content` (Docs/Sheets/Slides exported to text, other files downloaded), `list-permissions`, `create-folder`, `share-file`, `trash-file`. Built with `@gemstack/connectors`; consumes a Google OAuth 2.0 access token via the mount `credentials` seam. Second connector on the contract (epic #86).
