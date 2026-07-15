# @gemstack/framework

**The (AI) Framework** - turnkey, zero-config AI orchestration. Vite for AI.

It wraps a coding-agent CLI (Claude Code today) as a **black box** and takes you
from an idea to a running app, with a localhost dashboard that foregrounds the
orchestration the agent's own chat cannot show: the loop status, the review
passes, and the run's own event stream.

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

It runs on `@gemstack/ai-autopilot`'s spine (bootstrap flow, the loop, framework
presets, deploy targets) and adds the two missing pieces:

- **The driver seam** ([`Driver`](./src/driver/types.ts)) - the one abstraction
  we wrap an agent CLI behind. [`ClaudeCodeDriver`](./src/driver/claude-code.ts)
  is the first real driver (`claude -p` in stream-json mode, one fresh invocation
  per loop pass). [`FakeDriver`](./src/driver/fake.ts) is a deterministic offline
  driver for `--fake` and tests. Codex / opencode slot in behind the same three
  methods.
- **The product shell** - the `framework` CLI and the localhost
  [dashboard](./src/dashboard/server.ts) over an event stream we own. The
  dashboard has a **Stop** button that interrupts the run from the browser (it
  aborts the same signal Ctrl+C does); the run ends cleanly as *stopped*, and a
  persisted run reflects that so `--resume` shows it stopped.

Everything runs *through* the driver (single execution path): build and improve
are prompts; the production-grade checklist gates on the `{ blockers }` verdict
the agent ends its output with. What stack to build on is the agent's own call -
The Framework does not pick one for it.

**From-scratch or existing project.** Point `--cwd` at an empty directory and the
agent scaffolds the whole app from scratch. Point it at a project that already has
source and the framework detects the real stack (from its `package.json` + marker
files) and frames the agent to **extend** the codebase — read it, follow its
conventions, add what was asked — instead of rebuilding it from scratch.

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
framework doctor               Check prerequisites (Claude Code installed, etc.).
framework relay                Host a run relay so teammates can watch a run (see below).

  --cwd <dir>            Workspace the agent builds in (default: cwd).
  --model <id>           Model to pass through to the wrapped agent.
  --scope <prototype|full>   How much app to build (default: full).
  --max-passes <n>       Loop pass budget for a full build (default: 5).
  --preset <name>        Run under an Open Loop domain preset (see below).
  --autopilot            Activate the preset's Autopilot mode variants.
  --technical            Activate the preset's Technical mode variants.
  --kind <name>          Build event kind the preset's review loop fires for
                         (e.g. bug-fix or major-change; default: the preset's own).
  --compose-extensions   Opt the built-in capability extensions in (Vike-only; see below).
  --permission-mode <mode>   Claude Code permission mode: default | acceptEdits |
                         bypassPermissions | plan (default: bypassPermissions, so the
                         headless loop can run installs / builds / tests).
  --dangerously-skip-permissions   Bypass all agent permission checks (sandboxes only).
  --serve <cmd>          Gate the loop on the app actually running (e.g. "npm run dev"),
                         then keep it serving with a preview link on the dashboard.
  --serve-install <cmd>  Install command before serving (e.g. "npm install").
  --serve-build <cmd>    Build command before serving (e.g. "npm run build").
  --serve-port <n>       Port the app listens on (default: 3000).
  --serve-path <path>    Path to health-check once it is up (default: /).
  --sandbox <where>      Where --serve runs: "local" (host, default) or "docker"
                         (a throwaway container, so agent code never runs on the host).
  --deploy <target>      Deploy to this target (cloudflare, dokploy) or narrate any other.
  --cf-project <name>    Cloudflare Pages project name (for a Pages deploy).
  --dokploy-url <url>    Dokploy instance URL (required for --deploy dokploy).
  --dokploy-app <id>     Dokploy application id (required for --deploy dokploy).
  --port <n>             Dashboard port (default: 4200); with `relay`, the relay port (4488).
  --no-dashboard         Run headless.
  --share <relay-url>    Publish this run to a relay (see below) so teammates can watch it.
  --resume               Reopen the last run's dashboard from .the-framework/ (see below).
  --no-persist           Do not write the orchestration state to .the-framework/.
  --skip-preflight       Skip the prerequisite checks before a live run.
  --session-link <url>   Link to the live agent session (shown on the dashboard).
```

The live path needs the Claude Code CLI installed (`claude` on `PATH`). The
`--fake` path needs neither a CLI nor a model, so it is what CI runs.

### Persistence + resume

The orchestration state (the loop status and the run's event stream) is our part
of the run, not the agent's chat transcript, so we persist it. Each run appends
its event stream to `.the-framework/events.jsonl` in the workspace, with a small
`run.json` snapshot beside it. Because the dashboard is a pure projection of that
stream, a restart can replay it: `framework --resume` reopens the last run's
dashboard read-only, exactly
as it looked, without running the agent again. Add `--cwd <dir>` to resume a run
from another workspace. Pass `--no-persist` to skip writing state. We do not
persist the agent's transcript; Claude Code owns that.

The `.the-framework/` directory holds both the transient run state (`events.jsonl`,
`run.json`, `runs/`) and the committed project log `LOGS.md`. `install` seeds a
`.the-framework/.gitignore` that keeps the run state out of git so only `LOGS.md`
is tracked.

### Run history

Each finished run is archived under `.the-framework/runs/<id>.jsonl` (its log) and
`.the-framework/runs/<id>.json` (its snapshot). The dashboard's left sidebar lists a
project's past runs (intent, status, session link); clicking one replays that
run's projection in the main view, and **Back to live** returns to the current
run. The list is served by `GET /api/runs`, a single run by `GET /api/runs/<id>`
(#303). A crash that skips the final flush is still archived on the next run.

### Watching the session, and steering it live

Every run surfaces the current Claude Code **session id** on the dashboard (and in
the CLI narration) as soon as the wrapped agent reports it. That id is the local
transcript id: use it with `claude --resume <id>` to reopen the transcript. By
default the dashboard also shows an **Open Claude Code** link to
[claude.ai/code](https://claude.ai/code), a generic entry point (not a live link
to this run).

We drive Claude Code **headless**, which is deliberately not Remote-Controlled, so
there is no per-session URL to deep-link into (`--remote-control` is silently
ignored in headless mode, emits no URL, and
[Remote Control](https://code.claude.com/docs/en/remote-control) refuses
automation tokens anyway). To actually steer a session live in the browser, start
your **own** interactive session and open it from claude.ai/code:

```bash
claude auth login                          # full-scope login (Remote Control needs it)
claude --remote-control --name my-run      # interactive; find "my-run" at claude.ai/code
```

That is a separate process from an orchestration run, not the same agent. If you do
have a real per-session URL scheme, point the dashboard at it with
`--session-link "https://.../{sessionId}"` (`{sessionId}` fills in with the real
Claude session id once known), and the dashboard labels it a **live session**.

### Watching from more than one machine (#230)

The dashboard binds localhost. To let a teammate watch a run from another machine,
host a **relay** and publish the run to it:

```bash
framework relay                                # on a reachable host; prints its URL
framework "..." --share http://that-host:4488  # the run publishes its event stream to the relay
```

The run prints a shareable URL (`http://that-host:4488/r/<id>/`); open it from any
browser to watch the same dashboard live, replaying the run's full history first.
The relay only projects the event stream — it never runs an agent, and it is
unauthenticated (anyone with the URL can watch), so it is a keystone for shared
sessions, not the final hosted product. Accounts, teams, and steering layer on later.

## Open Loop domain presets (#204)

A **domain preset** bundles the review loops, prompts, and skills a kind of work
wants, so a run is framed for that domain instead of the generic web-app default.
Five ship built in:

- `software-development` — code-review + test-coverage + security-review on a
  major change; root-cause + regression-test on a bug fix.
- `web-development` — accessibility + performance-budget + web-security.
- `data-science` — reproducibility + data-validation + methodology.
- `product-management` — requirements + user-experience + metrics review;
  product-root-cause + regression-test on a fix.
- `biological-science` — experimental-design + data-provenance + statistical-rigor
  review; analysis-root-cause + regression-test on a fix.

Pick one with `--preset`. Its review loop drives the build's checklist, so the
loop's prompts are what gate each pass:

```bash
framework --preset software-development "Add an orders page with sign-in"
```

A run only builds under a preset when you ask for one: `--preset` or
`the-framework.yml`. With neither, the plain framework flow runs.

**Modes** tune a preset without swapping it. `--autopilot` and `--technical`
activate a preset's mode variants (e.g. a leaner review chain under `--technical`).
A mode flag with no `--preset` is a no-op and says so.

**Build event kind.** Each preset defines both a `major-change` and a `bug-fix`
review loop; the run picks one. `--kind bug-fix` fires the bug-fix loop instead of
the default. A build event with no preset is a no-op.

### Per-repo config: `the-framework.yml`

Instead of retyping flags every run, a project can commit its Open Loop defaults to
`the-framework.yml` (or `.yaml`) at the workspace root:

```yaml
preset: software-development
autopilot: true      # activate the preset's Autopilot mode variants
technical: false
event: bug-fix        # the build event kind its review loop fires for
antiLazyPill: false   # remove the built-in system prompt (default: on)
```

Every field is optional. CLI flags override the file, so the precedence is:

- **preset**: `--preset` > `the-framework.yml` `preset`
- **modes**: a flag and the file OR together (a flag can only *enable* a mode)
- **event**: `--kind` > `the-framework.yml` `event` > the preset's own default > `major-change`

When the file contributes anything, the run narrates it (`◆ the-framework.yml: ...`).
A malformed file is a warning, never a failed run.

### System prompt: the built-in working agreement + `SYSTEM.md`

Every prompt is framed with the built-in system prompt (#326, the successor of the
validated "anti-lazy-pill" #297): unclear scope becomes a ranked `showChoices()`
list, a large scope becomes a `PLAN_<session>.agent.md` to approve (a live
Approve/Decline gate on the dashboard; declining stops the run and hands control
back to you), a very large one
also spins off a `TODO_<session>.agent.md` backlog (consumed by the backlog loop),
an alternatives pass rates problem "variability" before code is written, and edits
to existing code stay minimal. The prompt is a template: `${{ ... }}` JS fragments
render against the run context (e.g. `tf.params.autopilot` relaxes the maintenance
stance on autopilot runs).

Drop a `SYSTEM.md` at the workspace root to add your own instructions on top (it
travels with the repo, like the memory files). To remove the built-in prompt and keep
only your own, set `antiLazyPill: false` in `the-framework.yml` (the key keeps its
historical name). The run narrates what it picked up (`◆ system prompt: SYSTEM.md`).

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
