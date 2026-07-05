# @gemstack/framework

## 0.6.0

### Minor Changes

- 4a6311e: Domain preset runs can now pick a build event kind, so a preset's bug-fix loop actually fires. A run chooses it with `runFramework({ buildEvent })` / the `framework --kind <name>` flag, and a preset can declare its own default via `preset.md` `metadata.event` (surfaced as `DomainPreset.defaultEvent`). Precedence: run choice > preset default > `major-change`; an event the preset has no loop for still falls back to the built-in checklist.
- b81e563: Run a build under an Open Loop domain preset (#251).

  `runFramework({ preset, modes })` now accepts a user-picked domain preset
  ({loops, prompts, skills}). Its skills (and their personas) frame every phase of
  the run alongside the detected framework skill, the selected domain and active
  modes are narrated, and its loops + prompts are materialized into a driver-backed
  `LoopEngine` exposed as `result.loop` (each pass is a fresh driver prompt). The
  new `driverLoopPrompts` bridge does the materialization. Opt-in and additive: a
  run with no preset is unchanged. Driving the exposed loop as a run phase is the
  follow-up (#252).

- c28c373: the-framework.yml gains an `event:` key so a repo can pin its build event kind (e.g. `bug-fix`) alongside `preset`/`autopilot`/`technical`. Precedence: `--kind` flag > `the-framework.yml` event > preset default > `major-change`.
- 74a9907: CLI: `--preset <name>` runs a build under an Open Loop domain preset, with
  `--autopilot` / `--technical` mode flags (#256).

  `--preset` resolves a shipped domain preset by name (via `builtinDomainPresets` +
  `selectPreset`) and hands it to `runFramework`, so its loops, prompts, and skills
  frame the build. `--autopilot` / `--technical` activate the preset's `conditions`
  variants (applied at load time and narrated). An unknown preset name is a usage
  error that lists the available presets; the mode flags note when given without a
  preset. Additive: a run with no `--preset` is unchanged.

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

- c24ae22: Read `the-framework.yml` for per-repo Open Loop defaults (#258).

  A project can now carry its own domain preset + modes, so you do not retype the
  flags each run:

  ```yaml
  preset: software-development
  autopilot: true
  ```

  The CLI reads it from the run's workspace and merges it with the flags: `--preset`
  wins over the file's `preset`; `--autopilot` / `--technical` OR with the file's
  booleans (a flag only ever enables a mode). A missing file is a no-op and a
  malformed one is a warning, never a failed run. New exports: `loadFrameworkConfig`,
  `parseFrameworkConfig`, `mergeRunConfig`, `FRAMEWORK_CONFIG_FILES`,
  `FrameworkFileConfig`.

- edd242b: Repo files as persistent AI memory (#260).

  The agent now reads the project's special files (CODE-OVERVIEW.md,
  KNOWLEDGE-BASE.md, BRAINSTORMING.md, DECISIONS.md) at the start of a run and is
  told to keep the ones it owns current, so a project's memory lives in the repo as
  plain markdown and the next run picks up where the last left off. `DECISIONS.md`
  stays framework-owned (we write it from the decisions ledger), so the agent reads
  it but does not edit it. New: `loadRepoMemory(cwd)`, `memoryFraming`,
  `MEMORY_FILES`, and a `memory` option on `runFramework`; the CLI reads the files
  from the workspace and frames them alongside personas and skills.

### Patch Changes

- Updated dependencies [4a6311e]
- Updated dependencies [8c3e7d0]
- Updated dependencies [03e06aa]
- Updated dependencies [3c72f14]
- Updated dependencies [e45e4d0]
- Updated dependencies [396dc7f]
- Updated dependencies [24944b9]
- Updated dependencies [d2acba4]
  - @gemstack/ai-autopilot@0.8.0

## 0.5.2

### Patch Changes

- 1d3ce64: Fix the Claude Code driver treating a non-zero agent exit as success when the agent had already streamed some text. A crash mid-build now fails the turn (surfacing stderr or the partial text) instead of resolving as a result the loop can score production-grade.
- 45b13b2: Default the CLI to bypassPermissions so the headless loop can build/verify

  Every framework turn is a headless `claude -p` invocation, which can't answer an
  interactive approval. The driver's library default (`acceptEdits`) auto-approves
  edits but not Bash, so installs/builds/tests were silently denied: the
  production-grade checklist tried `npm run build` / dev-boot, hit "Build needs
  interactive approval which isn't available," failed pass 1 as "could not be
  executed this session," and the loop ground on listing blockers it couldn't
  verify.

  The `framework` CLI now defaults its Claude Code driver to `bypassPermissions` so
  the full loop (install, build, test, dev-boot) runs unattended and the checklist
  verifies for real. This is a permissive default appropriate to a headless
  autonomous builder; `--permission-mode <mode>` still overrides it (e.g.
  `--permission-mode acceptEdits` for the old, conservative behavior), and
  `--dangerously-skip-permissions` still takes precedence. The `ClaudeCodeDriver`
  library default is unchanged (still `acceptEdits`); only the CLI opts up.

  Closes #225.

- 1259282: Fail closed when a checklist reply omits the required `{ blockers }` verdict. A verdict-less reply was scored as empty-blockers (production-grade) and stopped the loop; it now surfaces a blocker so the loop re-prompts instead of declaring the app done off an unverifiable reply.

## 0.5.1

### Patch Changes

- Updated dependencies [6f7e7e3]
  - @gemstack/ai-autopilot@0.7.0

## 0.5.0

### Minor Changes

- 16f6bb8: Stop a run from the dashboard

  The dashboard now has a **Stop** button that interrupts the running build from the browser, instead of only from the terminal. It POSTs to a new `/stop` route that aborts the run's `AbortSignal`, which `runFramework` checks between phases and the driver honours mid-turn (it kills the current agent turn). The run ends cleanly as _stopped_ (not _failed_): the CLI prints `■ Stopped` and exits 0, the dashboard shows a stopped status, and the persisted run records `status: "stopped"` so `--resume` shows it that way.

  `startDashboard` gains an `onStop` option (wire it to `controller.abort()`); the page hides the button when no stop handler is wired (e.g. a read-only `--resume` view). The `end` event gained an optional `stopped` flag.

  Part of #110 (first interactive slice of #165's web client). Closes #218.

### Patch Changes

- c7eae83: Label the dashboard session link honestly

  Our runs are headless, which is deliberately not Remote-Controlled, so the default `https://claude.ai/code` link is a generic entry point, not a live per-run session. The dashboard now labels it **Open Claude Code** instead of "live session"; the "live session" label is kept only for a real user-supplied `--session-link`. The real session id (the local transcript id, usable with `claude --resume`) is still shown.

  The README's session section is rewritten to be accurate: to steer a session live in the browser you start your own interactive `claude auth login` + `claude --remote-control --name <run>` session and open it from claude.ai/code, which is a separate process from an orchestration run. Corrects the overpromise from #212. Closes #221.

## 0.4.0

### Minor Changes

- c3e7e9e: Thread an active extension's own skills into the agent frame

  The extension SPI (#190) let a `FrameworkExtension` carry `skills` (llms.txt doc pointers), but `run.ts` only framed the built-in `SkillRegistry` matches, so a discovered extension's own skills were collected and then dropped. Add `composeSkills` (symmetric with `composePersonas`): it unions the registry-matched skills with every active extension's skills, deduped by name. `run.ts` uses it, so an active extension now contributes both its personas and its doc pointers to the frame. Surfaced by the new `examples/framework-discovery-demo` end-to-end proof, where the third-party `framework-hello` extension's `hello-guide` skill now reaches the agent.

- f156cf8: Default the live-run session link to claude.ai/code

  A live run now shows a session link to `https://claude.ai/code` by default (the page where a Claude Code session appears once Remote Control is enabled), so the dashboard points somewhere useful without needing `--session-link`. `--fake` gets no link (it has no real session), and an explicit `--session-link` still wins — including the `{sessionId}` template, which is filled in with the real Claude session id once known.

  Why not a per-session deep link: we drive Claude Code headless, and Remote Control (which powers the claude.ai/code session view) is opt-in and subscription-gated, so there is no session-URL slug to construct. The session id is already surfaced on the dashboard and in the CLI narration; the README's new "Watching the live session" section documents the Remote Control path. New exports: `chooseSessionLink`, `CLAUDE_CODE_SESSION_LIST`.

  Part of #209. Closes #212.

- 97b2943: Extend an existing project instead of rebuilding it from scratch

  Pointed at a workspace that already has source, the build step now frames the wrapped agent to work _within_ the existing codebase (read it, follow its conventions, add what was asked) rather than scaffold a fresh app. Greenfield runs (an empty workspace) are unchanged, and detection is gated on a real driver, so `--fake` stays deterministic. Combined with the live preset detection already wired from the real workspace, running in an existing project now detects its real stack and extends it.

  New exports: `extendPrompt`, `isWorkspaceEmpty`.

  Part of #110. Closes #185.

- de37e7e: Make The Framework modular: a capability-extension + skill SPI, discovered instead of hardcoded

  The composition was pinned in `run.ts` (a fixed `vikeExtensionPersonas` list swapped in behind `--compose-extensions`), so no third party could publish a `framework-*` package and have it compose. This adds the extension SPI (#190), all agnostic (nothing is framework-gated):

  - `defineFrameworkExtension` — a capability (auth, data, rbac, crud, shell, ...) that self-registers, matched by signal (a dependency is present) or opt-in, and frames the agent with its personas. An extension supersedes the neutral default persona of the same `capability` (e.g. `framework-data` replaces the default ORM modeler), so the agent never gets two conflicting personas for one concern.
  - `defineSkill` — a doc pointer (an `llms.txt`), the shared unit with Open Loop (#204). A framework is a skill, not an adapter package: Vike now rides the same seam as `https://vike.dev/llms.txt`.
  - `ExtensionRegistry` / `SkillRegistry`, `composePersonas`, `skillInstructions`, and `loadExtensionsFromModules` for discovering installed `framework-*` packages.

  `run.ts` now composes matched extensions + skills through the registry instead of the hardcoded list, and the CLI reads the project's real signals and discovers installed `framework-*` capability packages (resolved from the user's workspace, failures reported not thrown). The built-in vike-\* composers ship as extensions (`framework-auth`, `framework-data`, `framework-rbac`, `framework-crud`, `framework-shell`) and Vike ships as a skill, proving the seam. `--compose-extensions` still opts every built-in in; the publish-safe default (hand-rolled + Prisma) is unchanged. Closes #190.

- d98d4ad: Move the framework page builder off the preset onto its skill (fully skill-driven framing)

  A framework was represented twice: its page-builder persona rode the preset seam (`preset.personas`, framed as the run's base) while its docs rode the skill seam (`vike.dev/llms.txt`). This finishes the "framework = skill, adapter axis gone" design: a `Skill` now carries its own curated framing personas alongside the doc pointer, so all of a framework's knowledge lives in one unit. `vikeSkill` carries `vikePageBuilder`; the new `nextSkill` carries `nextPageBuilder`. A preset is now a pure detector that points at its framework `skill`, and `run.ts` frames the page builder through the skill set (the detected preset's skill is always framed, even on an empty from-scratch project where nothing signal-matched, since preset selection is the fallback). New exports: `nextSkill`, `skillPersonas`. `presetPersonas` and the framing narration are unchanged. Part of #190.

- a06e845: Persist the orchestration state so a restarted dashboard can resume it

  A run now saves its orchestration state (the stack rationale, loop status, and decisions ledger) so it survives a restart. Because the dashboard is a pure projection of the run's `FrameworkEvent` stream, persisting is durably logging that stream: each run appends to `.framework/events.jsonl` in the workspace, keeps a small derived `run.json` snapshot beside it, and writes a human-readable `DECISIONS.md` at the root. `framework --resume` reopens the last run's dashboard read-only by replaying the log into a fresh stream, exactly as it looked, without running the agent again. `--no-persist` opts out of writing state.

  Per the design sync we do not persist the agent's chat transcript (Claude Code owns that); only our own orchestration events. New `RunStore` module and exports (`RunStore`, `nodeStoreFs`, `metaFromEvents`, `applyEventToMeta`, `RunMeta`, `StoreFs`, ...); new `--resume` / `--no-persist` CLI flags.

  Part of #209. Closes #211.

- c79f567: Recover from-scratch builds: scaffold an empty workspace instead of only polishing

  The full-fledged loop assumed an app already existed, so a from-scratch run could end at the framework's default "Welcome" page. The build step now verifies it produced files and hard re-prompts to scaffold from scratch if the workspace is still empty; the improve step switches to a "create the whole app from scratch" directive when the workspace is empty (instead of "smallest change / no unrelated features"); and the default `--max-passes` is raised from 3 to 5 so a from-scratch build has room to recover. Also clarifies the dashboard/terminal end status ("finished", not "done", so it reads as separate from the production-grade badge). Closes #182.

- f1d11d9: Architect stack rationale: PROS/CONS + alternatives considered

  The web dashboard's edge over the CLI is showing _why_ the AI chose the stack. The architect step now returns that rationale, not just a one-line why:

  - `ArchitectPlan` gains optional `pros`, `cons`, and `alternatives` (`{option, whyNot}`). The `agentArchitect` (ai-sdk) and `driverArchitect` (framework) both ask for them and parse them; absent fields are omitted, so existing producers are unaffected.
  - A new exported `STACK_TRADEOFFS` block gives the architect objective, reusable Vike-vs-Next reasons (edge/Cloudflare deploy, renderer-agnostic, ecosystem size) so the justification is grounded rather than invented per run. Both architect prompts embed it.
  - The `Bootstrap` orchestrator emits `pros`/`cons`/`alternatives` on the `architect` event and records the rejected alternatives to the decisions ledger as rejections, so the ledger shows what was weighed.
  - The framework dashboard's "Stack & rationale" panel renders the pros, cons, and "Considered instead" alternatives. The `--fake` demo populates them.

  Part of #209. Closes #210.

### Patch Changes

- 5288ca6: Enforce the Vike-only constraint on `--compose-extensions`

  `--compose-extensions` is documented as Vike-only, but `runFramework` applied the vike-\* composer personas regardless of the detected preset, so a Next project would be framed with `nextPageBuilder` plus composers telling the agent to install vike-auth/vike-crud/etc.: an incoherent prompt. It now gates compose on the Vike preset and, on any other preset, falls back to the hand-rolled + Prisma path and emits a log explaining why.

- c9cf96b: Fix the `--compose-extensions` help text to name the full composer set

  The `framework --help` output described `--compose-extensions` as composing "vike-auth for auth" only, but the flag frames the agent with the whole vike-\* composer set: auth, the universal-orm data layer, rbac, crud/admin, and themes/layouts. The help text now names them accurately.

- Updated dependencies [1db19e2]
- Updated dependencies [c3e7e9e]
- Updated dependencies [6625ca7]
- Updated dependencies [bd13fcf]
- Updated dependencies [11f76da]
- Updated dependencies [c79f567]
- Updated dependencies [93892d7]
- Updated dependencies [de37e7e]
- Updated dependencies [d98d4ad]
- Updated dependencies [f1d11d9]
  - @gemstack/ai-autopilot@0.6.0

## 0.3.0

### Minor Changes

- 3006a91: Keep the generated app running after a successful `--serve` run and surface a live preview link. Once the boot-and-serve gate passes, the app is booted once more and left serving; the dashboard shows an "open your app" banner and the terminal prints the URL, both live until you stop the run (Ctrl+C tears the app down). `runFramework` now returns an optional `preview` handle (`{ url, command, stop() }`) so callers own the app's lifecycle.

## 0.2.0

### Minor Changes

- d31a260: feat: preflight checks + `framework doctor`

  A live run now checks its prerequisites first and fails early with a clear fix
  ("`claude` not found - install Claude Code ...") instead of a cryptic mid-run
  spawn error. Adds a `framework doctor` command that reports the checks, and a
  `--skip-preflight` escape hatch. `--fake` never runs preflight (it needs no CLI).

- d72accd: feat: `--serve` gates the loop on the app actually running

  When `--serve <cmd>` is set, the production-grade checklist no longer trusts only
  the agent's review: it adopts the agent's workspace, installs/builds/starts the
  app, and fetches it. A boot failure or a 5xx becomes a blocker the loop hands
  back to the agent to fix, so "production-grade" means it really serves. Adds
  `--serve-install`, `--serve-build`, `--serve-port`, `--serve-path`, the
  `serve` option on `runFramework`, and streams serve progress to the dashboard.

- c4545c2: Surface the live agent session on the dashboard. The wrapped agent's real session id is captured once the first turn returns and streamed as a new `session-update` event, so the dashboard header shows the live session (and the terminal prints it). `--session-link` now accepts a `{sessionId}` template that resolves to a real URL once the id is known; a literal URL still shows immediately.

### Patch Changes

- Updated dependencies [d72accd]
  - @gemstack/ai-autopilot@0.5.0

## 0.1.0

### Minor Changes

- f1e40d4: feat: @gemstack/framework - The (AI) Framework product shell

  The turnkey CLI + localhost dashboard that wraps a coding-agent CLI (Claude Code)
  as a black box and drives the ai-autopilot bootstrap flow through it: preset
  detect, architect, build, full-fledged loop, deploy. Adds the swappable `Driver`
  seam (`ClaudeCodeDriver` + `FakeDriver`), driver-backed bootstrap steps, an event
  stream we own, and a `--fake` offline path for CI. `npm i -g @gemstack/framework`.

- a08a052: feat: `framework` CLI exposes Claude Code's permission mode

  Add `--permission-mode <default|acceptEdits|bypassPermissions|plan>` and
  `--dangerously-skip-permissions`, threaded into `ClaudeCodeDriver`, so a live run
  can build non-interactively. Default stays `acceptEdits`.

- 779b0da: feat: `framework --deploy` actually ships via real deploy targets

  Wire ai-autopilot's `cloudflareTarget` / `dokployTarget` into the CLI so
  `--deploy cloudflare` / `--deploy dokploy` execute the deploy instead of only
  narrating a plan. Adds `--cf-project`, `--dokploy-url`, `--dokploy-app`, a
  `hostExecutor` that runs `wrangler` in the agent's workspace, and the `deployWith`
  step. Creds come from the environment; targets never throw on missing config
  (they report `{ deployed: false }`). `--fake` stays plan-only and deterministic.
