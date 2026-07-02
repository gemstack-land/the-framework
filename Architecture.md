# GemStack Architecture

A shared reference for how GemStack packages are layered and named. The AI family (`ai-sdk`, `ai-skills`, `ai-autopilot`, `ai-mcp`) and the standalone `@gemstack/mcp` server framework have all shipped; the design rationale below is kept as the record of why the boundaries are drawn where they are.

## The naming rule

The `ai-` prefix means **"depends on the agent runtime."** A package about AI that is agent-agnostic does not get the `ai-` prefix; it is a peer of the AI family, not a member.

## What belongs in GemStack: engines, not bindings

GemStack hosts **framework-agnostic engines** that work in any Node app. It does not host framework-specific bindings or extensions. This is the line that keeps the umbrella legible.

- **Engines (belong here):** `@gemstack/ai-sdk` and its family. They have no hard dependency on any framework.
- **Bindings (do not belong here):** framework extensions like the `vike-*` packages (in the `vike-data` repo). Their whole value is the framework integration, so they are the opposite of agnostic. They live with their framework and **consume** GemStack engines, e.g. `vike-ai` is a thin Vike binding over `@gemstack/ai-sdk`:

```
@gemstack/ai-sdk      (agnostic engine, here)
       ^
       | thin binding
vike-ai               (Vike extension, in vike-data) -- consumes the engine
```

### Graduation, not bulk relocation

Packages join GemStack by **graduating**, one at a time, when they prove framework-agnostic value, not by bulk-moving a framework's package set in.

- `@gemstack/ai-sdk` is the template: it matured inside Rudder as `@rudderjs/ai`, proved it was agnostic and broadly useful, then graduated to `@gemstack/`.
- A `vike-*` package moves here only if a genuinely agnostic *core* falls out of it that is useful beyond its framework. In that case the core graduates (e.g. `@gemstack/<core>`) while the framework binding stays `vike-*`.
- Because both repos are co-governed and the `vike-*` set sits in the Vike orbit, any such move is decided with the Vike team, when there is brand traction, not unilaterally.

### Graduation candidates already in `vike-data`

An audit of `vike-data` shows the agnostic engines are not in the `vike-*` packages (those are bindings) but in the `universal-*` packages, which already carry **zero Vike imports**. These are the real candidates, in priority order after `@gemstack/ai-sdk`:

| Candidate (today) | Would become | Notes |
|---|---|---|
| `@universal-orm/core` (+ `@universal-orm/drizzle` / `/memory` / `/rudder`) | `@gemstack/orm` (+ adapters) | The ORM analog of `@gemstack/ai-sdk`. Mature, clearly agnostic. The strongest next candidate; move the core + its adapter family together. |
| `@vike-data/universal-schema` | `@gemstack/schema` | "Usable standalone by any framework or ORM." Agnostic, but currently mis-scoped under `@vike-data`. |
| `@vike-data/kit` | (stays) | Agnostic primitives (`createPort`), but it is the kit for *authoring bindings*, so it belongs with the binding ecosystem, not the engine umbrella, unless GemStack later wants a shared-primitives package. |

Realized fully, GemStack is the unified home for agnostic engines: `@gemstack/ai-sdk` (AI), `@gemstack/orm` (data), `@gemstack/schema` (schema).

### The open brand-consolidation question (for the Vike team)

These are not orphaned code needing a home: `@universal-orm` is already its own deliberate npm scope, and `universal-schema` sits under `@vike-data`. So there are **three agnostic-ish scopes in play** (`@gemstack`, `@universal-orm`, `@vike-data`). The decision is therefore not "where should this code live" but **"do we consolidate the agnostic engines under one umbrella (`@gemstack`), or keep `@universal-orm` as a parallel brand?"** Since `@universal-orm` is co-developed, this is a decide-with-the-Vike-team call, gated on brand traction.

When a candidate does graduate, follow the `@gemstack/ai-sdk` playbook exactly: copy the source in, rename to the `@gemstack/*` name, leave a re-export at the old name, reset to a fresh `0.x` line, then repoint dependents. The old-name package takes one of two shapes: a **deprecated shim** (pure re-export, slated for eventual removal) or — when it has framework-coupled pieces that cannot graduate (provider wiring, ORM-backed stores, CLI) — a **living framework binding** that re-exports the agnostic core and owns those bindings. `@rudderjs/ai` is the latter: it re-exports `@gemstack/ai-sdk` and keeps the Rudder `AiProvider`, ORM stores, and `make:agent` / `ai:eval` CLI. Don't mislabel a binding as deprecated.

## The AI family

```
@gemstack/ai-sdk        agent runtime (the "verbs")
@gemstack/ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
@gemstack/ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
@gemstack/ai-mcp        agent <-> MCP bridge (the "adapter")           -> ai-sdk
-----------------------------------------------------------------------------------
@gemstack/mcp           standalone MCP server framework               agent-agnostic, NOT ai-*
```

### Dependency direction (the one rule that keeps four packages from becoming a tangle)

`skills`, `autopilot`, and `ai-mcp` all depend on `ai-sdk`. `ai-sdk` depends on none of them. Nothing depends "up." If the arrows are not one-directional, the split is wrong.

### What stays in the core vs what carves out

- **Stays in `ai-sdk`:** what is intrinsic to running an agent. Providers, the agent loop, tools, streaming, middleware, structured output, basic memory.
- **Carves out:** what has a heavy/optional dependency or a genuinely different consumer. `ai-mcp` is the first carve-out (it has its own SDK dependency and a distinct audience). `eval` is a good later candidate (dev/test-time, different lifecycle). Resist fragmenting into many micro-packages; each carve-out is a peer-dep seam maintained forever.

### Definitions

- **skill** = a portable, loadable capability bundle (instructions + tools + resources), composed onto an agent on demand. Distinct from a single `tool`. (See the `boost/skills/` `SKILL.md` bundles in `ai-sdk` for the shape.) `ai-skills` is the registry + loader + runtime for those bundles.
- **autopilot** = autonomy and orchestration: multi-agent, planning loops, long-running runs, handoffs.

## MCP taxonomy (two axes, do not conflate)

MCP shows up in GemStack in two fundamentally different roles. They point in opposite directions and must not be merged into one package.

| | Agent bridge | Server framework |
|---|---|---|
| **Package** | `@gemstack/ai-mcp` | `@gemstack/mcp` (agent-agnostic; not `ai-*`) |
| **Rudder origin** | `@rudderjs/ai/mcp` (a subpath today) | `@rudderjs/mcp` (a standalone package, mature) |
| **What it is** | A thin bridge that makes an **Agent** speak MCP | A full framework for **authoring MCP servers** |
| **Surface** | `mcpClientTools` (consume a remote MCP server's tools as Agent tools) + `mcpServerFromAgent` (wrap an Agent as an MCP server) | `McpServer`, `McpTool`, `McpResource`, `McpPrompt`, decorators (`@Name`/`@Version`/`@Instructions`), OAuth2 middleware, a provider, a test client, a `make-mcp-server` scaffolder |
| **Centered on** | the Agent abstraction | your application (a server can expose anything: DB, files, weather; no agent involved) |
| **Coupling** | depends on `ai-sdk`; useless without an Agent | agent-agnostic; does not depend on `ai-sdk` |
| **Use it when** | you are exposing an existing Agent, or feeding remote MCP tools into one | you are authoring a server from scratch (tools / resources / prompts / auth) |

**Why the AI layer has an inner mcp at all:** the bridge only makes sense with the Agent type, and it is optional (gated behind an optional `@modelcontextprotocol/sdk` peer dependency). So it lives next to the thing it extends, and consumers who never touch it never install the SDK. Forcing every AI user to pull in the whole server framework for two helper functions would be wrong.

**The "which MCP do I use?" decision (document this so the two never look like duplicates):**

> Exposing an existing Agent? Use `ai-mcp`. Authoring a server from scratch (tools / resources / prompts / auth)? Use `mcp`.

There is a tiny surface overlap (both can "produce an MCP server"), but from different inputs: `mcpServerFromAgent(anAgent)` versus a hand-authored `McpServer`. That is expected, not duplication.

## Connectors (built on `@gemstack/mcp`)

`@gemstack/connectors` is a small, agent-agnostic family on top of the server framework: a **connector contract** for wiring external services (GitHub, Google Drive, ...) into an agent as MCP tools. A connector `defineConnector`s its auth requirement and its tools and nothing else — it never reaches for env vars, OAuth, or a transport — and an orchestrator `mountConnectors` composes any number into one `@gemstack/mcp` server, supplying credentials and choosing the transport. That declare-needs / supply-later split is what lets first-party (`@gemstack/connector-*`) and third-party `connector-*` packages compose interchangeably. It sits on the `mcp` (server framework) axis, not the `ai-*` runtime axis: connectors depend on `@gemstack/mcp`, not on `ai-sdk`.

## `ai-mcp` carve-out (decided - see [issue #7](https://github.com/gemstack-land/gemstack/issues/7))

The bridge is two functions today. Decisions:

- **Promote to a package**, not keep a subpath. Beyond family symmetry, this makes the optional-dep boundary honest: `@modelcontextprotocol/sdk` is a peer of `ai-sdk` today, so every AI consumer sees it even though only `/mcp` uses it. As a package, only `ai-mcp` declares that peer. It is also the cheapest seam to prove the carve-out mechanism on before applying it to something heavier (`eval`).
- **Hard-move, no shim.** External importers of `@gemstack/ai-sdk/mcp` = 0 (ai-sdk is days old); internal = exactly 1 (`@rudderjs/ai/mcp`, a shim we control). A re-export shim would also create the cycle `ai-sdk -> ai-mcp -> ai-sdk`, violating the one-directional rule. So: remove the `./mcp` export and the `@modelcontextprotocol/sdk` peer from `ai-sdk` (breaking 0.x minor `0.2.0 -> 0.3.0`), start `ai-mcp` at a fresh `0.1.0`, repoint the one internal consumer, and add a migration note. Keep the deprecated-shim-for-one-minor play in reserve for the first carve-out *after* 1.0, where a real installed base exists.
- **Bridge only.** The standalone server framework (`@gemstack/mcp`) stays the other taxonomy axis and a separate graduation, not part of this carve-out. Ship the "which MCP do I use?" line (below) in `ai-mcp`'s README + npm description so the two never read as duplicates.

The seam is small and one-directional: `mcp/*` imports one runtime value (`dynamicTool`) plus four types (`Agent`, `HasTools`, `Tool`, `ToolCallContext`) from `ai-sdk`; `ai-sdk` imports nothing back. Still gated on family alignment with the Vike team before code lands.

## `ai-skills` design (decided - see [issue #8](https://github.com/gemstack-land/gemstack/issues/8))

Largely greenfield: it builds the registry + loader + runtime around the existing `boost/skills` convention. Decisions:

- **Manifest = `SKILL.md` frontmatter** (markdown-first), not a TS-first definition. YAML frontmatter (`name`, `description`, `trigger`, `skip`, `appliesTo`, `metadata`) + a markdown instructions body, exactly as `boost/skills` already ships. This keeps zero divergence from the shipped convention, matches the Anthropic Agent Skills shape (the portability moat: skills authored for Claude load here, gemstack skills ship as plain folders), and makes progressive disclosure fall out for free (index the cheap frontmatter, load the body on `trigger`).
- **Tools = reuse `ai-sdk` `tool()` directly.** A skill folder is `SKILL.md` + an optional co-located `tools.ts` exporting plain `tool()` objects; the loader imports and merges them. Namespacing / scoping (active only while loaded) is handled by the loader at composition time, not via a new authoring API. One tool API across the framework; skills stay self-contained. Portability note: the `SKILL.md` instructions/resources stay portable across agents, the typed `tools.ts` is the gemstack-specific binding (Anthropic skills bundle scripts instead) - an expected split, not a problem.
- **Security = explicit trust boundary, no in-process sandbox.** A skill is code you install/author, like any Vite/ESLint plugin; loading it runs its code. The framework makes the boundary honest: no auto-loading of untrusted directories (skills come from explicit, registered/allowlisted sources), surface-before-compose (report a skill's instructions/tools/resources before attaching), and reuse the existing tool-approval/middleware flow for the risky moment (tool execution). A true out-of-process / VM sandbox is out of scope (Node `vm` is not a security boundary, the permission model is process-wide) - recommend OS/container isolation around the app if real isolation is needed.
- **Composition = declarative `skills()` class method**, mirroring `tools()`/`middleware()`. Precedence is unambiguous: the agent's own declarations are authoritative and skills augment + yield on conflict. Instructions: the agent's `instructions()` is the base identity (first/wins), skill instructions composed in after. Tools: union of `agent.tools()` + skill tools in declaration order; on a name collision the agent's own tool wins, with the loader's namespacing as backstop. Progressive disclosure is independent of declaration - you declare the available set, the runtime loads each skill's body/tools lazily on `trigger` match.

Follow-up authoring options (low priority, revisit on demand): TS-first `defineSkill` (#11), a skill-scoped `skillTool()` wrapper (#12), and imperative `agent.use(skill)` runtime composition (#13). Still gated on family alignment before code lands.

## `ai-autopilot` design (shipped - see [issue #9](https://github.com/gemstack-land/gemstack/issues/9))

Began as the most speculative of the family (a Supervisor seed) and grew into the AI-building framework. It sits above the real `ai-sdk` primitives (`asTool`, `resumeAsTool`, `resumeManyAsTool`, `SubAgentRunStore`, stop conditions).

The enduring design rule:

- **Scope = policy, not mechanism.** The primitives are mechanism (transfer control, run a subagent, resume a paused run); autopilot is the reusable control loop deciding which agents run, in what order, how results combine, when to stop, under a budget/guardrail. Enforced rule: if a feature is just calling a primitive, it stays in `ai-sdk`; `ai-autopilot` only earns its keep as the topology / control-policy / run-lifecycle layer.

What shipped, built up from that seed (the state layer + the loop are the moat, not the prompts):

- **Supervisor** — the seed topology: plan -> dispatch subagents (bounded concurrency + token budget + per-subtask isolation) -> synthesize.
- **Personas** — reusable, stack-aware roles materialized into worker agents; **presets** (Vike flagship, Next.js) select the framework-specific ones by detecting the project's framework, on top of a framework-neutral core.
- **Runner** — a pluggable sandbox seam (`FakeRunner` + a real `LocalRunner`; Docker/WebContainer/Flue are infra-gated adapters) where agents build and run an app.
- **Surfaces** — the same run in a terminal, an in-page UI, or a detached background handle, over one replayable event stream.
- **Decisions ledger** — durable memory of rejected ideas + settled choices (round-trips `DECISIONS.md`) so a run stops re-pitching what was turned down.
- **The loop** — an event-to-prompt-chain policy (a major change fires review + code-quality + security; a new UI flow fires QA + UX), gating on a `{ blockers }` verdict, with a data-driven **prompt library**.
- **Bootstrap** — the spine that sequences the above into scope -> architect -> build -> full-fledged loop -> deploy, taking an app from nothing to production-grade.
- **Scale mode** — a self-maintaining `CODE-OVERVIEW.md`, refreshed only on material change.
- **Durability = in-process first.** Reuses `SubAgentRunStore` + resume primitives for pause/resume; a durable/queue-backed runner arrives as an optional adapter, not core.

The whole flow is demonstrated offline (no API key) in [`examples/bootstrap-quickstart`](./examples/bootstrap-quickstart); live end-to-end verification against a real model + `LocalRunner` is the infra-gated remainder.

## Ship order (all shipped)

The family shipped in the order that proved the dependency seam earliest:

1. `@gemstack/ai-sdk` (shipped)
2. `@gemstack/ai-mcp` (shipped - first carve-out; cheap, and forced the dependency seam to be proven early)
3. `@gemstack/ai-skills` (shipped)
4. `@gemstack/ai-autopilot` (shipped)
5. `@gemstack/mcp` (shipped - the standalone server framework, a separate graduation off `@rudderjs/mcp`)
