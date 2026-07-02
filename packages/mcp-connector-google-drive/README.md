# @gemstack/mcp-connector-google-drive

A Google Drive connector for GemStack AI orchestration. Browse, read, and share Drive files over the Drive REST API (v3). Built with [`@gemstack/mcp-connectors`](../connectors); the result is a standard `@gemstack/mcp` server.

## Install

```bash
npm i @gemstack/mcp-connector-google-drive @gemstack/mcp-connectors @gemstack/mcp
```

## Use

```ts
import { mountConnectors } from '@gemstack/mcp-connectors'
import { Mcp } from '@gemstack/mcp'
import drive from '@gemstack/mcp-connector-google-drive'

const Server = mountConnectors([drive], {
  // A Google OAuth 2.0 access token with a Drive scope.
  credentials: () => ({ token: process.env.GOOGLE_ACCESS_TOKEN }),
})

Mcp.web('/mcp/drive', Server)
```

Tools are exposed namespaced by connector id, e.g. `google-drive_list-files`.

## Auth

Drive has no static API key — it is OAuth 2.0 only. The connector declares `auth: { type: 'oauth', scopes: ['https://www.googleapis.com/auth/drive'] }` and consumes a bearer token from `ctx.auth.token`; it does no OAuth handshake itself. Use `drive.readonly` if you only need the read tools. To protect a web endpoint and obtain the token, wrap it with `@gemstack/mcp`'s `oauth2McpMiddleware` + `registerOAuth2Metadata` and feed the verified token through the mount `credentials` option.

## Tools

| Tool | Kind | Description |
|---|---|---|
| `get-about` | read | Authenticated user + storage usage |
| `list-files` | read | List files (folder / raw query scoped) |
| `search-files` | read | Search by name and full-text content |
| `get-file` | read | Metadata for one file or folder |
| `get-file-content` | read | File as text (Docs exported, others downloaded) |
| `list-permissions` | read | Who has access to a file |
| `create-folder` | write | Create a folder |
| `share-file` | write | Grant access (create a permission) |
| `trash-file` | write (destructive) | Move a file to the trash (reversible) |

Read tools are annotated `readOnly` so an agent can auto-approve them; write tools are not, and `trash-file` is marked `destructive`.

Responses are slimmed to the fields an agent needs (no raw API envelopes) to keep token usage down.
