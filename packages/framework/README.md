# @gemstack/framework

**The (AI) Framework** - turnkey, zero-config AI orchestration. Vite for AI.

It wraps a coding-agent CLI (Claude Code today) as a **black box** and takes you
from an idea to a running app, with a localhost dashboard that foregrounds the
orchestration the agent's own chat cannot show: the chosen stack and its
rationale, the loop status, and the decisions ledger.

```bash
npm i -g @gemstack/framework

framework "a paginated orders page backed by an orders table, with sign-in"
# or the deterministic offline demo (no CLI, no model):
framework --fake
```

## How it works

The Framework does not run its own agent. It drives a coding agent as a **black
box**: it sends a prompt, lets the agent's *own* loop run, reads the code it
produced, and gates on the **outcome** (builds / serves / review-passes), then
re-prompts. The seam is the code, never the agent's individual tool calls, so the
wrapped agent keeps its subscription-based auth and stays swappable.

It runs on `@gemstack/ai-autopilot`'s spine (bootstrap flow, the loop, the
decisions ledger, framework presets, deploy targets) and adds the two missing
pieces:

- **The driver seam** ([`Driver`](./src/driver/types.ts)) - the one abstraction
  we wrap an agent CLI behind. [`ClaudeCodeDriver`](./src/driver/claude-code.ts)
  is the first real driver (`claude -p` in stream-json mode, one fresh invocation
  per loop pass). [`FakeDriver`](./src/driver/fake.ts) is a deterministic offline
  driver for `--fake` and tests. Codex / opencode slot in behind the same three
  methods.
- **The product shell** - the `framework` CLI and the localhost
  [dashboard](./src/dashboard/server.ts) over an event stream we own.

Everything runs *through* the driver (single execution path): the architect is a
small structured JSON decision the agent returns; build and improve are prompts;
the production-grade checklist gates on the `{ blockers }` verdict the agent ends
its output with.

## Library API

```ts
import { runFramework, ClaudeCodeDriver, startDashboard } from '@gemstack/framework'

const dashboard = await startDashboard()
console.log(dashboard.url)

await runFramework({
  intent: 'a blog with comments',
  driver: new ClaudeCodeDriver(),
  cwd: process.cwd(),
  onEvent: dashboard.push,
})
```

## CLI

```
framework [intent...]          Build what you describe, from scratch.
framework --fake               Offline demo (no CLI, no model, deterministic).

  --cwd <dir>            Workspace the agent builds in (default: cwd).
  --model <id>           Model to pass through to the wrapped agent.
  --scope <prototype|full>   How much app to build (default: full).
  --compose-extensions   Opt the built-in capability extensions in (Vike-only; see below).
  --deploy <target>      Narrate a deploy decision (e.g. cloudflare, dokploy).
  --port <n>             Dashboard port (default: 4477).
  --no-dashboard         Run headless.
  --session-link <url>   Link to the live agent session (shown on the dashboard).
```

The live path needs the Claude Code CLI installed (`claude` on `PATH`). The
`--fake` path needs neither a CLI nor a model, so it is what CI runs.

## Extensions (#190)

The Framework is modular: it composes **capability extensions** and **skills**
into the agent frame instead of hardcoding a fixed list. Nothing is framework-gated.

- A **capability extension** (`framework-auth`, `framework-data`, ...) owns a
  cross-cutting concern. When it matches a project it frames the agent with its
  personas. An extension with the same `capability` as a built-in default
  supersedes it (e.g. `framework-data` replaces the default ORM modeler), so the
  agent never gets two conflicting personas for one concern.
- A **skill** is a doc pointer — an `llms.txt` the agent consults for
  framework/domain knowledge. A framework is a skill, not an adapter package:
  Vike is `https://vike.dev/llms.txt`.

An extension activates two ways: by **signal** (one of its dependencies is in the
project's `package.json`) or by **opt-in** (`--compose-extensions` turns the
built-ins on, for a from-scratch build where nothing is installed yet).

The built-ins are the vike-* composers: `framework-auth` (vike-auth for identity),
`framework-data` (the universal-orm data layer for domain data), `framework-rbac`
(vike-rbac for roles/permissions), `framework-crud` (vike-crud/vike-admin for
schema-derived CRUD + admin UI), and `framework-shell` (vike-themes/vike-layouts
for styling and the app shell). They resolve only inside the vike-data workspace,
so `--compose-extensions` is Vike-only and ignored on any other preset; the default
path (hand-rolled auth + Prisma) is the one that stays publishable.

### Authoring a `framework-*` extension

Publish a package named `framework-<name>` (or `@scope/framework-<name>`) whose
default export is a `FrameworkExtension`:

```ts
// framework-sentry/src/index.ts
import { defineFrameworkExtension, definePersona, defineSkill } from '@gemstack/ai-autopilot'

export default defineFrameworkExtension({
  name: 'framework-sentry',
  capability: 'tracking',
  // deps/files that auto-activate it in a project:
  signals: { dependencies: ['@sentry/node', '@sentry/react'] },
  // personas frame the agent; skills point it at authoritative docs:
  personas: [definePersona({
    name: 'error-tracker',
    role: 'Wires Sentry for error tracking instead of hand-rolling logging',
    systemPrompt: 'Install @sentry/node and wrap the server; never hand-roll error capture. ...',
  })],
  skills: [defineSkill({
    name: 'sentry', title: 'Sentry', description: 'Error tracking + performance.',
    url: 'https://docs.sentry.io/llms.txt',
  })],
})
```

When a user's project depends on both `@gemstack/framework` and
`framework-sentry`, the CLI discovers the package, registers it, and composes it
whenever its signal matches — no change to the framework core.

## Status

MVP (#166): the driver seam, the Claude Code driver, the CLI, and the dashboard,
verified end-to-end via `--fake`. Real deploy shipping and additional drivers are
follow-ups.
