# Contributing & Graduation

GemStack is shared, community-governed infrastructure built in the open with the [Vike](https://vike.dev) team. This page explains how the project grows and how to get involved.

## The graduation model

GemStack does not grow by bulk-moving a framework's package set in. Packages join one at a time, by **graduating**: a package earns a place under the `@gemstack/` scope when it proves framework-agnostic value, not when it is merely useful to one framework.

In practice a package graduates when it is:

- **Framework-agnostic.** It runs in any `fetch`-capable Node runtime and does not depend on a specific web framework, ORM, or UI library. Anything framework-specific stays in that framework's own binding.
- **Neutral about infrastructure.** Persistence, caching, and storage are expressed as contracts the caller implements, with in-memory defaults for getting started. The package does not bundle a database or a queue.
- **Well-tested and documented.** It ships a real test suite and a guide here.
- **Composable.** It works on its own and composes cleanly with the rest of the family through the shared primitives (one `toolDefinition()` shape, one `Agent` base, one provider config).

The AI engine is the worked example: it was spun out of Rudder's `@rudderjs/ai`, decoupled from every framework binding, and re-versioned as [`@gemstack/ai-sdk`](/packages/ai-sdk/). The framework-specific pieces (an ORM-backed store set, a service provider, CLI scaffolders) stayed behind in the Rudder binding, which now re-exports the engine.

## Bindings vs the engine

A recurring shape in GemStack is **engine + binding**. The engine is the framework-agnostic core that lives here. A binding is a thin, framework-specific package that re-exports the engine and wires it into one framework's conventions (its container, config, ORM, and CLI).

If you maintain a framework, the path is: depend on the GemStack engine, implement its neutral contracts against your framework's infrastructure, and ship that as your own binding. Your users keep importing from your package; the engine stays shared.

## Ways to contribute

- **File issues.** Bugs, missing capabilities, and rough edges in any package. Reproductions and a clear "expected vs actual" make these actionable fast.
- **Improve the docs.** These guides live in the repo under `docs/`. Fixes and clarifications are welcome; run `pnpm --filter @gemstack/docs docs:build` before opening a PR to catch dead links.
- **Propose a graduation.** If you have a framework-agnostic package that fits the bar above, open an issue describing what it does and why it belongs in GemStack rather than in a single framework.
- **Build a binding.** Wire the engine into your framework and let us link it from here.

The repository, issues, and discussions live at [github.com/gemstack-land/gemstack](https://github.com/gemstack-land/gemstack).

## Next

- [What is GemStack?](/guide/) - the family and the design principles.
- [When to Use GemStack](/guide/when-to-use) - where it fits.
- [Packages overview](/packages/) - every package and how they compose.
