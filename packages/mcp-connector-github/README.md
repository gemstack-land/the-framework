# @gemstack/mcp-connector-github

A GitHub connector for GemStack AI orchestration. Read and act on issues, pull requests, and repository files over the GitHub REST API. Built with [`@gemstack/mcp-connectors`](../connectors); the result is a standard `@gemstack/mcp` server.

## Install

```bash
npm i @gemstack/mcp-connector-github @gemstack/mcp-connectors @gemstack/mcp
```

## Use

```ts
import { mountConnectors } from '@gemstack/mcp-connectors'
import { Mcp } from '@gemstack/mcp'
import github from '@gemstack/mcp-connector-github'

const Server = mountConnectors([github], {
  // A token with `repo` scope. A PAT or an OAuth bearer both work.
  credentials: () => ({ token: process.env.GITHUB_TOKEN }),
})

Mcp.web('/mcp/github', Server)
```

Tools are exposed namespaced by connector id, e.g. `github_list-issues`.

## Auth

The connector declares `auth: { type: 'pat', env: 'GITHUB_TOKEN' }`. It only consumes a bearer token from `ctx.auth.token` — it does no OAuth handshake itself. To protect a web endpoint with OAuth 2.1, wrap it with `@gemstack/mcp`'s `oauth2McpMiddleware` + `registerOAuth2Metadata` and feed the verified token through the mount `credentials` option.

## Tools

| Tool | Kind | Description |
|---|---|---|
| `get-repo` | read | Repository metadata |
| `list-issues` | read | Issues (excludes PRs) |
| `get-issue` | read | One issue by number |
| `list-pull-requests` | read | Pull requests |
| `get-pull-request` | read | One PR by number |
| `get-file` | read | File contents (base64-decoded) |
| `search-issues` | read | Search issues/PRs (GitHub search syntax) |
| `comment-on-issue` | write | Comment on an issue or PR |
| `create-issue` | write | Open a new issue |

Read tools are annotated `readOnly` so an agent can auto-approve them; write tools are not.

Responses are slimmed to the fields an agent needs (no raw API envelopes) to keep token usage down.
