# @gemstack/ai-autopilot

## 0.11.0

### Minor Changes

- 66c7aeb: The bootstrap checklist's default event kind now resolves against `defaultLoops()` (#974)

  `loopChecklist` fires `production-check` by default, but `defaultLoops()` only defined
  `major-change` and `ui-flow`. The event matched no loop, so the checklist never saw a
  `production-grade` verdict, treated the missing verdict as a blocker, and
  `BootstrapResult.productionGrade` could never be `true` on the documented default path.
  Every caller had to hand-write the missing loop.

  `LOOP_EVENTS` gains `productionCheck: 'production-check'` and `defaultLoops()` now returns a
  third loop, `production-check -> [production-grade]`. The shipped `production-grade` prompt
  declares that event too, so `library.byEvent('production-check')` returns it.

  Behaviour change for anyone spreading `defaultLoops()`: the returned array now has three
  entries instead of two, and an event of kind `production-check` that previously fell through
  as unmatched now runs the `production-grade` prompt. If you already added your own
  `production-check` loop, both fire and the prompt ids are de-duped across matching loops, so
  the chain is unchanged. To keep the old policy, filter the gate out.

### Patch Changes

- 6f7cf23: Fix four orchestration correctness bugs and tidy the package surface.

  - `exec()` now runs in its own process group and settles even when a background grandchild outlives the shell. Previously a command like `npm install` that left a daemon behind kept the inherited stdio open, so `close` never fired and the call never settled, blowing past its own `timeoutMs`.
  - `serveCheck` bounds its health-check fetch. A dev server that accepts the connection but never answers used to hang the bootstrap pass loop forever, since neither the fetch nor the process exit could settle.
  - A blocking loop chain (`continueOnError: false`) now stops at an unknown prompt id instead of running past it. A typo'd or unregistered id silently bypassed a gate that a _throwing_ prompt would have stopped.
  - `runPool` no longer reports truncation when the budget is met exactly by the final item, which surfaced as a false `stoppedEarly` / `budget-exceeded` with `skipped: 0` on a plan that ran to completion. Worker errors also propagate through `allSettled`, so one failure cannot orphan its siblings into unhandled rejections.

  Also: exported `AgentSynthesizerOptions` (the only `agent*` factory whose options were unnameable), dropped three dead imports in `bootstrap/steps.ts`, corrected two doc comments that claimed one shipped domain preset when five ship, removed a doc comment describing a function that had moved, and fixed `clean` scripts that left `dist-test/` behind (stale compiled tests cause phantom failures).

- Updated dependencies [6f7cf23]
- Updated dependencies [6f7cf23]
- Updated dependencies [6f7cf23]
- Updated dependencies [da79ec8]
  - @gemstack/ai-sdk@0.5.1
  - @gemstack/ai-skills@0.2.2

## 0.10.0

### Minor Changes

- 9442761: Remove the architect. A build no longer runs a turn to pick the app's stack, and no longer tells the agent what to build on: the agent reads the workspace and decides for itself, the same way it would outside The Framework. `buildPrompt` / `extendPrompt` / `scaffoldPrompt` now take just the intent and say nothing about a stack.

  Being opinionated about the stack is a hard thing to do well, and a system prompt that nudges one is worse than none at all (#545). The stack guidance we had was not designed, it accumulated. It goes rather than half-ships.

  Gone with it, because the architect was their only source:

  - the plan-approval gate ("Approve this plan?" / "Use X instead") and re-architect. The agent-authored await gates a build turn raises are unaffected: a build that stops to ask still pauses the run with Approve / Decline.
  - the decisions ledger in a run, and the `DECISIONS.md` a run wrote from it. `@gemstack/ai-autopilot`'s `decisions/` module is untouched and still exported; nothing in a run feeds it now.
  - the dashboard's "Stack & rationale" and "Decisions ledger" panels. Loop status, deploy, and session cards are unchanged.
  - `@gemstack/ai-autopilot`: `agentArchitect`, `STACK_TRADEOFFS`, `BootstrapSteps.architect`, `BootstrapOptions.ledger`, the `architect` bootstrap event, `ArchitectPlan` / `ArchitectContext` / `ArchitectDecision` / `ArchitectAlternative`, and the `plan` field on the build / loop / deploy contexts and on `BootstrapResult`. The flow is now scope -> build -> loop -> deploy.
  - `@gemstack/framework`: `driverArchitect`, `reArchitect`, `architectPrompt`, `parseArchitectPlan`, `architectPlan`, `decisionLedger`, `RunFrameworkResult.ledger`, and the `bench:architect` benchmark.

- 5e24797: Remove the persona, skill, and project-memory framing. A run's system prompt is now the built-in #326 prompt plus your own `SYSTEM.md`, and nothing else. Nothing is read off disk and appended when the run starts.

  A build used to append the personas and skills for its detected stack plus the full contents of the repo's memory files. On one measured 8,852-character build prompt that framing was about 5,000 characters, more than the designed prompt it was wrapping. None of that text was designed; it accumulated. Prompt text nobody reviewed is a defect, not a feature (#547).

  Two things fall out of this:

  - **The prompt preview is now exact.** The dashboard's "See actual prompt sent" (#520) had to carry a caveat that a build run appends more at run time. It no longer does, so the caveat is gone and what you read before the run is what the agent gets, for every run kind.
  - **A build stops being opinionated about the stack.** #545 removed the architect turn, but the personas still hard-instructed a stack ("Default to Prisma"). With both gone, nothing tells the agent what to build on.

  Skills and project memory are worth having as designed features later. They are not worth keeping in this shape.

  Removed from `@gemstack/framework`: the `memory` / `extensions` / `composeExtensions` options on `runFramework`, the `framing` option on `composeRunSystem` (`RunSystemOptions` is now `SystemPromptOptions`), `loadRepoMemory` / `memoryFraming` / `MEMORY_FILES`, `discoverExtensions`, and the `--compose-extensions` flag. `readProjectSignals` moved to `project.js` and is still exported from the root; preset detection still runs and still narrates `Detected <framework>`.

  Removed from `@gemstack/ai-autopilot`: the `personas/` and `extensions/` modules (`definePersona`, `composePersonas`, `personaInstructions`, `personaTools`, `personaAgent`, `personaWorkers`, `personaRoster`, `stackPersonas`, `neutralPersonas`, `presetPersonas`, `defineSkill`, `SkillRegistry`, `composeSkills`, `skillInstructions`, `FrameworkExtension` and its registry). `Preset` is now `{name, framework, signals}`, a pure detector; `DomainPreset` loses `skills` and keeps its loops, prompts, and modes.

  `@gemstack/ai-skills` is untouched. It is a different thing (an on-disk `SKILL.md` loader for ai-sdk agents) and is unaffected by any of this.

### Patch Changes

- 734da1a: fix(ai-autopilot): EventStream iterators are now cancellable

  A consumer's async iterator gained a `return()` that drops its waiter from the stream and settles any pending `next()`. Previously a consumer that stopped iterating (e.g. a disconnected SSE client) left its waiter registered until the next `push`/`close`, so many short-lived consumers on an idle stream leaked. Live iteration and history replay are unchanged.

- df15f71: FakeFs now enforces the same workspace-escape guard as the real runners. Its filesystem previously stored any path as a map key, so a `write('../evil.txt', ...)` that a real runner rejects was silently accepted. Code exercised only against `FakeRunner` never saw the escape path, then threw against Docker/Local/WebContainer. `FakeFs` now routes every path through the shared `safeSegments` guard, rejecting escapes and resolving `.`/`..` exactly as the real runners do.

## 0.9.0

### Minor Changes

- 08f5710: feat(ai-autopilot): add Product Management and Biological Science domain presets (#275)

  Ships the last two of Rom's #204 domain list as built-in Open Loop presets, so the set is now five: Software Development, Web Development, Data Science, Product Management, and Biological Science.

  - **Product Management** reviews a substantial change against the requirement it serves, the experience it gives the user, and whether its success is measurable; a fix traces the user impact and root cause before it is locked in. Technical Control runs the leaner requirements review only.
  - **Biological Science** reviews an analysis or pipeline for sound experimental design, trustworthy data provenance, and statistical rigor; a fix traces the analytical cause before it is locked in. Technical Control runs the experimental-design review only.

  Both are pure `.md` content under `presets/`, auto-discovered by `builtinDomainPresets()`, so meta-select and `--preset` can route to them with no further wiring. Each ships a real stable skill reference (Shape Up; Ten Simple Rules for Reproducible Computational Research).

## 0.8.0

### Minor Changes

- 4a6311e: Domain preset runs can now pick a build event kind, so a preset's bug-fix loop actually fires. A run chooses it with `runFramework({ buildEvent })` / the `framework --kind <name>` flag, and a preset can declare its own default via `preset.md` `metadata.event` (surfaced as `DomainPreset.defaultEvent`). Precedence: run choice > preset default > `major-change`; an event the preset has no loop for still falls back to the built-in checklist.
- 8c3e7d0: The domain loop drives the production-grade review phase (#252).

  When a run has a domain preset, its review loop now _replaces_ the built-in
  checklist: each pass dispatches a `major-change` event through the preset's
  driver-backed loop, so its review chain (e.g. code review, test coverage, security
  review) fires through the wrapped agent, and Bootstrap's pass / improve / maxPasses
  machinery gates on the union of the `{ blockers }` verdicts the chain reports. A
  preset with no loop for the build event falls back to the built-in checklist, so a
  run is never left unreviewed. New: `domainLoopChecklist` + `verdictFromLoopRun`
  (@gemstack/framework).

  The shipped Software Development preset's review prompts (code review, test
  coverage, security review) now end with a `{ blockers }` verdict so the loop
  actually gates rather than only running.

- 03e06aa: Add the Open Loop bundle unit: a domain preset = {loops, prompts, skills} (#242).

  This is the keystone that ties the three data types the framework already ships
  separately into one selectable, composable thing. Author one in code with
  `defineDomainPreset`, or load one from a directory of `.md` files (`preset.md` +
  `loops/`, `prompts/`, `skills/`) with `loadDomainPreset`. `composeDomainPresets`
  merges several into one (loops concatenate; prompts and skills merge by id/name,
  later wins), so presets-of-presets falls out; `selectPreset` picks the user's
  domain by name. Kept distinct from the framework `Preset` detector in `presets/`
  (skipped for the Open Loop MVP) by naming this `DomainPreset`.

- 3c72f14: Add modes (Autopilot / Technical) to domain presets via `conditions` frontmatter (#244).

  A preset content file can now ship mode variants: a `stem.<variant>.md` sibling
  that declares `metadata.conditions` (a mode or list) overrides its `stem.md` base
  when those modes are active. `loadDomainPreset(dir, { modes })` (and
  `softwareDevelopmentPreset({ modes })`) resolve the winner per stem — the most
  specific eligible variant, falling back to the base. The shipped Software
  Development preset gains a `technical` variant of its major-change loop as an
  illustration. This is the simple frontmatter fan-out; composing prompts from
  parameters is the follow-up (#245).

- e45e4d0: Preset discovery API: enumerate domain presets so the CLI/UI picker can list and
  pick one by name (#254).

  `builtinDomainPresets()` loads every domain preset shipped under the package's
  `presets/` directory (today just Software Development; new built-ins are picked up
  automatically). `loadDomainPresetsFrom(dir)` loads every immediate subdirectory
  that holds a `preset.md`, skipping the rest, sorted by name. Pair either with the
  existing `selectPreset(list, name)` to pick the user's chosen domain.

- 396dc7f: Rename the loop engine's `rules` vocabulary to `loops` (Open Loop, #241).

  A loop is a meta prompt, so that is the user-facing unit even though rule logic powers it. `defineLoop` / `defaultLoops` / `Loop` / `LoopSpec` replace `defineRule` / `defaultLoopRules` / `LoopRule` / `LoopRuleSpec`; the engine class is now `LoopEngine` (was `Loop`), created via `createLoopEngine` with `LoopEngineOptions`; and its option key is `loops` (was `rules`). Vocabulary only, no behavior change.

- 24944b9: Ship the "Software Development" domain preset (#243).

  The first built-in Open Loop preset, authored as a directory of `.md` files:
  two loops (major-change -> code-review + test-coverage + security-review; bug-fix
  -> root-cause + regression-test), five stack-agnostic prompt bodies, and one skill
  pointer. Non-web and user-picked (no dependency detection). Load it with
  `softwareDevelopmentPreset()`; `builtinPresetsDir()` points at the shipped
  `presets/` directory. Proves the bundle unit end to end.

- d2acba4: Add two more built-in domain presets: `web-development` and `data-science`.

  Each ships as a directory of `.md` files like `software-development`, so it is
  auto-discovered by `builtinDomainPresets()`, selectable via `--preset <name>` and
  `the-framework.yml`, and drives the review phase. Both carry a Technical Control
  variant (leaner major-change loop) and a bug-fix loop. Their major-change review
  prompts end with the `{ blockers }` verdict footer so the review loop gates.

  - **web-development** — accessibility, performance budget, and web-security review; skill points at web.dev.
  - **data-science** — reproducibility, data validation, and methodology review; skill points at Google's Rules of ML.

## 0.7.0

### Minor Changes

- 6f7e7e3: Add WebContainerRunner, the in-browser sandboxed runner

  `WebContainerRunner` is the third real `Runner` adapter (after `LocalRunner` and
  `DockerRunner`), wrapping StackBlitz's `@webcontainer/api`. It runs untrusted,
  agent-authored code entirely inside a browser tab: an in-browser Node runtime, an
  isolated filesystem, and an instant `preview()` URL for a dev server, with nothing
  touching the host. This is the "sit on harnesses, don't compete" bet for the
  browser: the same `Runner` interface, now backed by WebContainer.

  It is browser-only by construction (WebContainer needs `SharedArrayBuffer`, so the
  hosting page must be cross-origin isolated), so `@webcontainer/api` is an optional
  peer dependency and is imported lazily: loading `@gemstack/ai-autopilot` in Node
  never pulls it in. Guard with the new `webContainerAvailable()` and reach for
  `DockerRunner` on the server.

  Because a WebContainer cannot boot in Node, boot-and-serve is proven by a headless
  Chromium harness under `packages/ai-autopilot/harness/webcontainer/` that drives
  the compiled adapter through boot, fs, exec (exit codes, cwd/env, timeout kill),
  start, a real preview URL, an in-container serve check, dispose, and reboot. The
  Node-only guards are covered by the default test suite.

  Part of #109 (the Flue adapter stays gated on a live Flue environment).

## 0.6.0

### Minor Changes

- 1db19e2: Teach the compose personas the opt-in real-persistence path (drizzle + pglite)

  The composed stack (vike-auth + the universal-orm data layer) runs on the memory adapter, which resets on every server restart, so accounts and posts vanish on reboot. The `vike-data-modeler` persona now teaches the "make it real" swap: register the Drizzle adapter over an embedded pglite Postgres instead of the memory adapter, add the `vikeSchema()` Vite plugin to codegen `drizzle/schema.generated.ts`, and derive/apply migrations with drizzle-kit. Because auth and domain data ride the same one adapter, that single swap makes both durable at once; `defineSchema` tables and `db()` queries do not change. The `vike-auth-composer` persona points at the same step, and the memory adapter stays the zero-config dev default. Reference: the proven `examples/drizzle-pglite` twin. Part of #186. Closes #187.

- c3e7e9e: Thread an active extension's own skills into the agent frame

  The extension SPI (#190) let a `FrameworkExtension` carry `skills` (llms.txt doc pointers), but `run.ts` only framed the built-in `SkillRegistry` matches, so a discovered extension's own skills were collected and then dropped. Add `composeSkills` (symmetric with `composePersonas`): it unions the registry-matched skills with every active extension's skills, deduped by name. `run.ts` uses it, so an active extension now contributes both its personas and its doc pointers to the frame. Surfaced by the new `examples/framework-discovery-demo` end-to-end proof, where the third-party `framework-hello` extension's `hello-guide` skill now reaches the agent.

- 6625ca7: Compose vike-crud / vike-admin for the CRUD/admin UI instead of hand-writing screens

  The composed stack taught the agent to compose vike-auth (identity) and the universal-orm data layer (domain data), but it still hand-wrote the list/record/form screens and admin panel, which is the largest chunk of fresh, churn-prone AI code. The new `vike-crud-composer` persona (wired into `vikeExtensionPersonas`) teaches the agent to derive those screens from the schema instead: `crud({ table })` / `crudBlocks({ table })` inside a `definePage`, rendered through `vike-crud/react` (or `/vue`); vike-admin dropped on top for a whole-DB `/admin/*` panel via the cumulative `adminResources` seam; mutations through named `crudActions` (`posts.delete`) rather than inline closures; and the config -> slot -> eject customization ladder so eject is the last resort, not the starting point. Everything rides the one universal-orm adapter already registered, so there is nothing extra to install. No runtime change; the agent stays a black box. Part of #186. Closes #189.

- bd13fcf: Compose vike-rbac for roles/permissions instead of hand-rolling authz

  The crud composer teaches ad-hoc role checks (`canEdit: (user) => user?.role === 'admin'`), which is fine for signed-in-vs-not but leaves the agent to hand-roll a roles/permissions schema and a permission checker the moment an app has named permissions or more than one role. The new `vike-rbac-composer` persona (wired into `vikeExtensionPersonas`, between auth and crud) teaches the agent to compose vike-rbac instead: declare permissions with `definePermissions` and `extends: ['import:vike-rbac/config:default']` (self-installs vike-auth), route every guard through the same `can(user, permission)` / `hasRole(user, role)` (the crud `canView`/`canEdit`, page guards, session scope, and vike-actions guards all delegate to it), and seed roles/permissions from the composed registry with `seedRbac()` rather than a hand-written list. vike-rbac owns the `roles`/`permissions`/`role_user`/`permission_role` tables and is the guard subject vike-admin and vike-actions are built around. No runtime change; the agent stays a black box. Part of #186. Closes #194.

- 11f76da: Compose vike-themes / vike-layouts for styling and the app shell instead of hand-rolling CSS + nav

  After auth, data, and the CRUD/admin UI, the remaining big hand-rolled surface is styling and the app shell: an agent writes its own CSS design system, dark-mode toggle, and layout/nav chrome on every build, and that fresh CSS is the root of the loop's over-polish churn. The new `vike-shell-composer` persona (wired into `vikeExtensionPersonas`) teaches the agent to declare a brand with `defineTheme` and `extends: [themesExt]` (flash-free system dark mode, a picker, and a CSS-variable contract to style against) instead of hand-writing a color system, and to pick a shell with `vike-layouts` (`layout: 'centered' | 'topbar' | 'sidebar'` plus `logo` / cumulative `nav` slots) instead of a hand-written topbar/sidebar. It also notes the one-line `vike-toolbar` install that gives the theme/locale controls a home. No runtime change; the agent stays a black box. Part of #186. Closes #192.

- c79f567: Point the flagship data persona at Prisma (installable) instead of the unpublished universal-orm

  The bootstrap data persona told the agent to build the data layer on `universal-orm`, which isn't installable (`@universal-orm/core` 404s on npm), so from-scratch live builds stalled sanity-checking the stack and produced nothing. It now defaults to Prisma with concrete install/init steps (schema-first, migrations derived from the schema, a fully typed client), and the architect default no longer names an unpublished package. The persona export is renamed `universalOrmModeler` -> `dataModeler` (persona name `data-modeler`). Closes #181.

- 93892d7: Export the vike-rbac / vike-crud / vike-shell composer personas individually

  `vikeAuthComposer` and `vikeDataModeler` were re-exported individually from the package root, but their three peers `vikeRbacComposer`, `vikeCrudComposer`, and `vikeShellComposer` were only reachable through the `vikeExtensionPersonas` array. They are now exported individually too, so a consumer building a custom persona roster can cherry-pick any of the built-in extension composers uniformly. No runtime change.

- de37e7e: Make The Framework modular: a capability-extension + skill SPI, discovered instead of hardcoded

  The composition was pinned in `run.ts` (a fixed `vikeExtensionPersonas` list swapped in behind `--compose-extensions`), so no third party could publish a `framework-*` package and have it compose. This adds the extension SPI (#190), all agnostic (nothing is framework-gated):

  - `defineFrameworkExtension` — a capability (auth, data, rbac, crud, shell, ...) that self-registers, matched by signal (a dependency is present) or opt-in, and frames the agent with its personas. An extension supersedes the neutral default persona of the same `capability` (e.g. `framework-data` replaces the default ORM modeler), so the agent never gets two conflicting personas for one concern.
  - `defineSkill` — a doc pointer (an `llms.txt`), the shared unit with Open Loop (#204). A framework is a skill, not an adapter package: Vike now rides the same seam as `https://vike.dev/llms.txt`.
  - `ExtensionRegistry` / `SkillRegistry`, `composePersonas`, `skillInstructions`, and `loadExtensionsFromModules` for discovering installed `framework-*` packages.

  `run.ts` now composes matched extensions + skills through the registry instead of the hardcoded list, and the CLI reads the project's real signals and discovers installed `framework-*` capability packages (resolved from the user's workspace, failures reported not thrown). The built-in vike-\* composers ship as extensions (`framework-auth`, `framework-data`, `framework-rbac`, `framework-crud`, `framework-shell`) and Vike ships as a skill, proving the seam. `--compose-extensions` still opts every built-in in; the publish-safe default (hand-rolled + Prisma) is unchanged. Closes #190.

- d98d4ad: Move the framework page builder off the preset onto its skill (fully skill-driven framing)

  A framework was represented twice: its page-builder persona rode the preset seam (`preset.personas`, framed as the run's base) while its docs rode the skill seam (`vike.dev/llms.txt`). This finishes the "framework = skill, adapter axis gone" design: a `Skill` now carries its own curated framing personas alongside the doc pointer, so all of a framework's knowledge lives in one unit. `vikeSkill` carries `vikePageBuilder`; the new `nextSkill` carries `nextPageBuilder`. A preset is now a pure detector that points at its framework `skill`, and `run.ts` frames the page builder through the skill set (the detected preset's skill is always framed, even on an empty from-scratch project where nothing signal-matched, since preset selection is the fallback). New exports: `nextSkill`, `skillPersonas`. `presetPersonas` and the framing narration are unchanged. Part of #190.

- f1d11d9: Architect stack rationale: PROS/CONS + alternatives considered

  The web dashboard's edge over the CLI is showing _why_ the AI chose the stack. The architect step now returns that rationale, not just a one-line why:

  - `ArchitectPlan` gains optional `pros`, `cons`, and `alternatives` (`{option, whyNot}`). The `agentArchitect` (ai-sdk) and `driverArchitect` (framework) both ask for them and parse them; absent fields are omitted, so existing producers are unaffected.
  - A new exported `STACK_TRADEOFFS` block gives the architect objective, reusable Vike-vs-Next reasons (edge/Cloudflare deploy, renderer-agnostic, ecosystem size) so the justification is grounded rather than invented per run. Both architect prompts embed it.
  - The `Bootstrap` orchestrator emits `pros`/`cons`/`alternatives` on the `architect` event and records the rejected alternatives to the decisions ledger as rejections, so the ledger shows what was weighed.
  - The framework dashboard's "Stack & rationale" panel renders the pros, cons, and "Considered instead" alternatives. The `--fake` demo populates them.

  Part of #209. Closes #210.

## 0.5.0

### Minor Changes

- d72accd: feat(runner): `LocalRunner.adopt(dir)` binds an existing directory as the workspace

  Adopt a directory that already exists instead of booting a fresh temp one. The
  session reads, execs, starts, and previews inside it exactly like a booted
  session, but `dispose` does not delete it (the directory belongs to the caller).
  Fills a real gap in the runner seam: running or verifying code that another tool
  already wrote to disk.

## 0.4.0

### Minor Changes

- 87e6804: Add `cloudflareTarget` — the first real `DeployTarget` adapter for bootstrap mode.

  `cloudflareTarget({ session, ... })` ships the built app to Cloudflare via the `wrangler` CLI, run inside the build's runner session: install, build, then deploy to **Workers** (SSR) or **Pages** (SSG/SPA), reporting the live URL wrangler printed. Credentials come from `apiToken`/`accountId` (or `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`) and are passed to `wrangler` through the command environment, so they work whether the session is local or a container. It never throws — a missing token, failed build, or failed deploy return `{ deployed: false, detail }` so the final phase narrates rather than crashing.

  Wire it on the existing seam: `agentDeploy(deployer, { target: cloudflareTarget({ session, projectName }) })`.

- 8d913dd: Add `dokployTarget` — a second real `DeployTarget`, for self-hosted Dokploy.

  `dokployTarget({ serverUrl, applicationId })` triggers a deployment of a pre-configured Dokploy application over the Dokploy API (`POST /api/application.deploy`, `x-api-key` auth). Dokploy builds and serves the app server-side, so — unlike `cloudflareTarget`, which builds and uploads from the session — this target is a simple API trigger and takes no runner session. It never throws: a missing token, a bad response, or a network failure return `{ deployed: false, detail }`. Credentials come from `apiToken` or `DOKPLOY_AUTH_TOKEN` / `DOKPLOY_API_KEY`.

  Also fixes the spelling of the deploy target in `DEFAULT_DEPLOY_TARGETS`: `dockploy` → `dokploy` (the real product name).

### Patch Changes

- fc21943: Export `DockerRunner`, `DockerRunnerSession`, `dockerAvailable`, and `DockerRunnerOptions` from the package entry.

  The runner barrel exported these symbols, but the main entry point omitted them, so the shipped `DockerRunner` adapter could not actually be imported from `@gemstack/ai-autopilot`. They are now reachable alongside `FakeRunner`/`LocalRunner`.

## 0.3.0

### Minor Changes

- 0823cfa: Runner: `DockerRunner` — the first sandboxed adapter, running agent-authored code in a container.

  `DockerRunner` boots each workspace as a container via the `docker` CLI (no npm dependency), so untrusted, agent-authored code runs isolated from the host: its own filesystem, process space, and — with `preview` — a published port mapped to an ephemeral host port. It satisfies the same `Runner` contract as `LocalRunner` (fs / exec / start / preview / dispose), so it drops in behind the seam unchanged: `new DockerRunner({ image?, previewPort?, previewHost? })`.

  Where `LocalRunner` runs commands unsandboxed on the host (trusted dev/CI), `DockerRunner` is the one to reach for when the code is untrusted. It requires a running Docker daemon and the `docker` CLI on `PATH`; the default `node:20-alpine` base image carries `node`/`npm` and a POSIX shell. `dockerAvailable()` reports whether a daemon is reachable so callers (and the test suite) can skip cleanly when it isn't.

  WebContainer and Flue remain the still-parked sandboxed adapters (#109).

- 7ce5bae: Runner seam: long-running processes + reachable previews (boot-and-serve).

  `RunnerSession.start(command)` launches a long-running command (a dev server) in the background and returns a `RunnerProcess` handle (`{ command, exit, stop() }`) — unlike `exec`, which awaits the command to finish. `preview({ waitMs })` now waits for the port to accept connections before resolving, so the URL is live on return. A `start_server` runner tool exposes this to agents.

  `LocalRunner` implements it for real: `start` spawns in its own process group so `stop()` (and `dispose()`) kill the whole tree; `preview` polls the port. `FakeRunner` mirrors it for tests. This is the contract every sandboxed adapter (Docker / WebContainer / Flue) must satisfy, and it's what makes "produce a running app" reachable end to end.

- 493cc11: Bootstrap: `serveCheck` — a production-grade check that actually boots and serves the app.

  Until now the full-fledged loop gated on a prompt verdict (`loopChecklist` asks the model whether the app is production-grade). `serveCheck(session, { serve, install?, build?, port?, healthPath? })` gives it teeth: inside the build's runner session it installs, optionally builds, `start`s the dev server, `preview`s until the port is reachable, and fetches a health path — turning any failure (install error, server exits on boot, a 5xx, unreachable) into a concrete `{ blockers }` verdict the improve loop then addresses. It satisfies the `checklist` step contract, and `mergeChecklists(...)` unions several checks so a pass must BOTH read production-grade AND actually run: `mergeChecklists(loopChecklist({ loop }), serveCheck(session, { serve: 'npm run dev' }))`. A runner that can't `start`/`preview` skips the check (passing, with a note) instead of blocking. Built on the #137 runner seam.

## 0.2.0

### Minor Changes

- 70168c5: Add bootstrap's deploy phase and the `DeployTarget` adapter seam. The final phase decides the rendering mode (SSR/SSG/SPA) and the deploy target (Dockploy vs Cloudflare), narrates the plan, and hands it to a `DeployTarget` — the same pattern as the runner seam. `agentDeploy` is the default step (an `ai-sdk` agent decides `{ render, target, reason }`, normalized against the allowed sets); `planOnlyTarget` is the v1 default that decides and narrates without shipping, and `FakeDeployTarget` backs tests. v1 decides + narrates only; real Dockploy / Cloudflare adapters implement `DeployTarget` and are infra-gated follow-ups, so bootstrap never does a blind deploy. The deploy step is optional and its outcome rides on `BootstrapResult.deploy`. Closes #123.
- 11dce73: Add bootstrap mode's orchestrator core: the spine that sequences autopilot's primitives into scope → architect → build → full-fledged loop, taking a user from nothing to a running, production-grade app. `Bootstrap` owns the control flow (the loop, the gate, the interrupt) over four injectable steps, narrating each phase over the generic surface stream and recording the architect's choices to the decisions ledger — no permission asked. The full-fledged loop repeats the production-grade checklist with fresh context, improving against its `{ blockers }` verdict until it is empty or a `maxPasses` budget stops it; prototype scope skips it. Default step builders wire the steps onto the real primitives — `agentArchitect` (an `ai-sdk` agent + the decisions briefing), `supervisorBuild` (the `Supervisor` over personas + runner), and `loopChecklist` / `loopImprove` (the Loop) — so the same orchestrator runs against real agents in production or stubs + `FakeRunner` in a test. Verified end-to-end offline. Closes #122.
- aa1925f: Add scale mode: an always-current `CODE-OVERVIEW.md` the agent reads first in a large repo so it stays oriented without re-scanning the tree. The hard part is keeping it fresh — a stale overview is worse than none — so refreshes are gated by a deterministic **material-change detector** (`detectMaterialChange`): a build/config change, a test-framework migration, a directory restructure, or a large change across many areas, not every routine edit. `CodeOverviewMaintainer` owns the policy (refresh on material change, skip otherwise, persist over an `OverviewFs`); `agentOverview` regenerates the map with an `ai-sdk` agent (seeding the previous overview so it revises rather than rewrites); and `overviewLoopPrompt` drops the maintainer into the loop (#113) so it self-maintains on `major-change`. The `CODE-OVERVIEW.md` markdown round-trips via `parseOverview` / `serializeOverview`. Regeneration is injected, so the whole policy is tested offline against a stub. Closes #114.
- c9b4d0d: Add the decisions ledger: durable project memory so a run stops re-pitching ideas that were already turned down. `DecisionLedger` records rejected ideas and settled choices and answers `consult(idea)` / `wasRejected(idea)` (lexical token-overlap matching, deterministic) before the agent proposes; it round-trips a human-editable `DECISIONS.md` via `loadLedger` / `saveLedger` over a storage-agnostic `LedgerFs` seam (a subset of the runner's `RunnerFs`, with a `nodeLedgerFs()` host adapter). `decisionTools(ledger)` exposes `consult_decisions` + `record_decision` to an agent and `decisionBriefing(ledger)` renders the rejected set as a system-prompt fragment. Verified end-to-end on real disk. First child (#112) of the AI-framework epic (#110); the state layer "the loop" (#113) will consult.
- 57cbba4: Add the web-app preset seam: framework-specific knowledge selected by detecting the app's framework, on top of the agnostic core. A `Preset` bundles a framework's personas with the signals that identify it; `detectFramework` scores a project's dependencies + files (deps weigh more than files) and `PresetRegistry.select` picks the preset (falling back to the flagship when nothing matches). Ships two built-ins — `vikePreset` (flagship) and `nextPreset` — plus a new `nextPageBuilder` persona (App Router + React Server Components). `presetPersonas(preset)` returns the framework page builder followed by the shared, framework-neutral personas (`sharedPersonas`: the universal-orm modeler + intent-UI designer), so only the page builder changes between frameworks while the rest of the stack stays put and prompts stay neutral. One shared core; a new framework is a new `Preset`, not a runtime fork. Closes #115.
- 04965c5: Generalize the surface stream to be event-type generic. `EventStream<E>`, `AutopilotHandle<E, R>`, and `launchAutopilot<E, R>` now take the event (and result) type as parameters, defaulting to the supervisor's `SupervisorEvent` / `SupervisorRun` so every existing supervisor surface is unchanged. This lets bootstrap (and any future surface) stream its own narration events and return its own result over the same replayable, detached transport. Closes #120.
- 07cc623: Add `LocalRunner`, the first real adapter behind the runner seam. Where `FakeRunner` simulates a workspace in memory, `LocalRunner` boots each workspace as a real temp directory on the host: real files via `node:fs` (path-traversal guarded to the workspace root), real commands via `child_process` (shell, per-command `cwd`/`env`/`timeoutMs`), a localhost `preview`, and a `dispose()` that removes the workspace. It is the reference the sandboxed adapters (WebContainer, Docker, Flue) mirror. It runs commands unsandboxed on the host, so it is documented for trusted/CI use only, not untrusted agent-authored code. Part of the ai-autopilot epic (#97), issue #106.
- 7fde5fc: Add the personas layer: stack-aware roles that make autopilot opinionated about the GemStack stack (Vike + universal-orm) instead of generic. `definePersona()` builds a role from a system prompt + skills (composed over `@gemstack/ai-skills`) + tools; `personaAgent()`/`personaWorkers()` materialize personas into Supervisor workers; `personaRoster()` describes them to a planner so plans route to the right role. Ships three built-ins: `vikePageBuilder`, `universalOrmModeler`, and `uiIntentDesigner` (the "declare intent, decouple implementation" UI guardrail). First child (#98) of the ai-autopilot end-to-end epic (#97).
- 55b3697: Add the `production-grade` checklist prompt and a `{ blockers }` verdict convention. The new built-in prompt judges an app against a production-grade checklist (auth, data layer, error handling, instrumentation, emailing, validation, tests, build/config) and ends with a machine-readable `{ "blockers": [...] }` verdict — an empty list means production-grade. `parseVerdict()` / `isPassing()` read it back, and the loop now gates on that outcome: a `PromptOutcome` carries `verdict` and a `passing` flag (executed _and_ no blockers), and `continueOnError: false` stops the chain on `!passing`. Backward compatible — with no verdict reported, `passing === ok`; pass `verdict: null` for an execution-only gate. This is what bootstrap's full-fledged loop repeats against until blockers is empty. Closes #121.
- 8f780f3: Add the built-in prompts library: the stack-aware prompt _bodies_ the loop dispatches, shipped as data. Eight markdown bundles under `prompts/` (review TLDR + thorough, code-quality, security, refactor, UX, QA, knowledge-base) that already know Vike + universal-orm, loaded with `builtinLibrary()` / `loadPromptsFrom(dir)` into a `PromptLibrary` and parsed via `@gemstack/ai-skills`' frontmatter (a contributor edits prose, not code). `loopPromptsFor(library, makeAgent)` materializes them into loop prompts so `defaultLoopRules()` ids resolve to real bodies (a fresh agent per pass); `promptInstructions` composes a body with the decisions briefing (#112) and `renderTask` turns a `LoopEvent` into the worker's task. Closes the turnkey wire across #111 / #112 / #113. Verified end-to-end against the built package. Child #111 of the AI-framework epic (#110).
- b0c0647: Add the runner seam: a pluggable `Runner` execution environment (workspace filesystem + shell + optional preview URL), shaped after Flue's `sandbox` contract so WebContainer, Docker, and Flue sandboxes drop in behind one interface. Ships the interface plus `FakeRunner` (the runner analog of `ai-sdk`'s `AiFake`) for infra-free testing, and `runnerTools(session)` to expose a booted session to an agent as sandbox tools (`read_file`, `write_file`, `list_files`, `exec`, `preview`). Real adapters (FlueRunner, WebContainer, Docker) land separately. Interface-first slice of the runner child (#99) of the ai-autopilot epic (#97).
- d261873: Add surfaces: run the same autopilot in the terminal, an in-page UI, or a background process, all over the Supervisor's `onEvent` stream. `terminalSink()` prints events inline (`formatEvent()` renders one event as a line); `EventStream` is a replayable multi-consumer transport with offset/tail replay (borrowing Flue's Durable-Streams `tail=N`); `launchAutopilot(start)` runs a Supervisor detached and returns an `AutopilotHandle` (`status()`, `events(offset)`, live async `stream()`, `result()`) that backs both the background and in-page (SSE) surfaces. Verified end-to-end against a real Supervisor. Closes the surfaces child (#100) of the ai-autopilot epic (#97).
- 481c2f0: Add "the loop": the event-to-prompt-chain policy. The agent declares a semantic `LoopEvent` (a change `kind`) and the matching prompt chain fires: a major change runs review + code-quality + security, a new UI flow runs QA + UX. `Loop.handle(event)` resolves the chain from `LoopRule`s (`defineRule` / `defaultLoopRules()` as the built-in policy) and runs each `LoopPrompt` (`definePrompt`) for its `passes` with fresh context every pass; `matches(event)` is the pure preview, `watch(stream)` handles a stream fire-and-report. Design calls on the two open questions: the trigger is agent-declared (not heuristic), and both modes ship (`handle` awaits; `continueOnError: false` is a blocking gate). Consults the decisions ledger via `ctx.ledger`, and references the prompts library (#111) by id. Verified end-to-end. Child #113 of the AI-framework epic (#110).

## 0.1.2

### Patch Changes

- Updated dependencies [dbc8b3a]
- Updated dependencies [1b2ba93]
  - @gemstack/ai-sdk@0.5.0

## 0.1.1

### Patch Changes

- 81fe17b: Quality + docs pass for ai-autopilot:

  - `Supervisor` now validates its options at construction (`plan` must be a function, `workers` is required, `concurrency`/`maxSubtasks` must be positive integers) and `run()` rejects an empty task, so misconfiguration fails fast with a clear message instead of deep in a planner call.
  - An `onEvent` callback that throws is now isolated (logged and swallowed) so an observer bug can no longer abort a supervised run.
  - Corrected the `SupervisorRun.usage` docs: it aggregates dispatched-subtask usage only (the `Planner`/`Synthesizer` contracts return data, not usage, so planning/synthesis spend isn't observable).
  - Clarified that `maxSubtasks` and `budget` are optional, marked the internal `runPool` helper `@internal`, and added JSDoc examples.

- Updated dependencies [e784b5d]
- Updated dependencies [97ed299]
- Updated dependencies [4fa5820]
- Updated dependencies [cf28664]
- Updated dependencies [035050e]
- Updated dependencies [3cb13db]
  - @gemstack/ai-sdk@0.4.0

## 0.1.0

### Minor Changes

- 8796ae4: Initial release. Orchestration for `@gemstack/ai-sdk` agents — the control-policy layer over many agent runs. Seed slice: the supervisor/worker topology.

  - `Supervisor` — **plan → dispatch → synthesize**: decompose a task into subtasks, dispatch each to a worker agent (bounded concurrency, optional token budget, per-subtask error isolation), and synthesize the results.
  - `agentPlanner(agent)` — turn a planning agent into a `Planner` via `ai-sdk`'s `Output.array` (JSON subtask decomposition).
  - `agentSynthesizer(agent)` / `defaultSynthesize` — combine subtask results (LLM pass, or deterministic concatenation).
  - Pluggable stages (`plan` / `workers` / `synthesize`), guardrails (`concurrency`, `maxSubtasks`, `budget.maxTotalTokens`), and progress events.

  Scope boundary: `ai-sdk` owns the single-agent loop + handoff/subagent primitives; `ai-autopilot` owns orchestrating multiple runs under a policy. The seed runs autonomous workers; durable pause/resume, more topologies, and queue-backed execution are deferred behind optional seams. Depends on `@gemstack/ai-sdk`.

### Patch Changes

- Updated dependencies [9da9b29]
  - @gemstack/ai-sdk@0.3.0
