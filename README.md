# GemStack

A collection of high-quality, framework-agnostic tools.

GemStack is shared, community-governed infrastructure built with the [Vike](https://vike.dev) team. Each tool is a standalone, well-tested package that works in any Node app and composes cleanly with the others.

## Packages

| Package | Description | Status |
|---|---|---|
| [`@gemstack/ai-sdk`](./packages/ai-sdk) | AI engine: providers, agents, tools, streaming, middleware, memory, evals, MCP, computer-use | `0.1.0` |

More layers are planned under the same scheme: `@gemstack/ai-skills`, `@gemstack/ai-autopilot`, `@gemstack/ai-mcp`.

`@gemstack/ai-sdk` is the pilot package, spun out of Rudder's mature `@rudderjs/ai` (v1.17.x) and re-versioned under the GemStack umbrella, while `@rudderjs/ai` continues as a thin deprecated re-export.

## Development

```bash
pnpm install
pnpm build        # build all packages (Turborepo)
pnpm dev          # watch mode
pnpm typecheck
pnpm test
```

This is a pnpm + Turborepo + Changesets monorepo. See [`.changeset/README.md`](./.changeset/README.md) for the release flow.

## Governance

GemStack is co-governed (shared npm `@gemstack` org + `gemstack-land` GitHub org). New tools join by mutual agreement; publish rights and 2FA are shared per the governance note.

## License

[MIT](./LICENSE)
