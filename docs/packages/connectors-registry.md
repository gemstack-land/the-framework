# The connector registry

Connectors are the open, copyable layer of GemStack orchestration. Anyone can ship one: build it with [`@gemstack/connectors`](/packages/connectors), publish it to npm under the `connector-*` convention, and an orchestrator can mount it next to the first-party connectors with no special blessing.

## First-party connectors

| Connector | Package | Auth | What it does |
|---|---|---|---|
| [GitHub](/packages/connector-github) | `@gemstack/connector-github` | PAT / OAuth bearer | Read and act on issues, pull requests, and repository files. |
| [Google Drive](/packages/connector-google-drive) | `@gemstack/connector-google-drive` | Google OAuth 2.0 | Browse, read, and share Drive files (Docs/Sheets/Slides exported to text). |

Both are thin connectors over a REST client on the [`@gemstack/connectors`](/packages/connectors) contract — read them as canonical examples when writing your own.

## Naming convention

Publish a connector package as **`connector-<service>`** (first-party: `@gemstack/connector-github`; third-party: `@your-scope/connector-acme` or `gemstack-connector-acme` unscoped). The connector's runtime `id` — the value that namespaces its tools — should match the service (`github`, `google-drive`, `acme`).

The convention is what makes connectors discoverable: a search for `connector-` on npm, or the GitHub topic [`gemstack-connector`](https://github.com/topics/gemstack-connector), surfaces the ecosystem the same way [Vike's extensions listing](https://vike.dev/extensions) does for Vike.

## Publish your own

1. Build it with [`@gemstack/connectors`](/packages/connectors) — start from `examples/connectors-quickstart`.
2. Name the package `connector-<service>` and add the `gemstack-connector` keyword + GitHub topic.
3. Declare its `auth` honestly (`none` / `pat` / `oauth`) so an orchestrator knows what credential to resolve.
4. Publish to npm. That's it — there's no registry to register with; the naming convention *is* the registry.

To get a third-party connector linked from this page, open a PR or an issue on [gemstack-land/gemstack](https://github.com/gemstack-land/gemstack/issues).

## See also

- [`@gemstack/connectors`](/packages/connectors) — the contract and the "writing a connector" guide.
- [`mcp`](/packages/mcp) — the server a mounted connector becomes.
