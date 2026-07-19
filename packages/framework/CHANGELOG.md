# @gemstack/framework

## 0.9.0

### Minor Changes

- 68555e4: Self-heal a run whose process died without writing its `end` event (#716). A crash, `kill -9`, or the machine sleeping used to leave `.the-framework/run.json` stuck at `status: running` forever: the dashboard showed a permanently RUNNING row whose Stop was a no-op (nothing was left to consume `control.jsonl`), and it only cleared on a daemon restart. The run now records its owning pid and host in `run.json`, and `readLiveMeta` flips a `running` run to `stopped` (and archives it) on read when that owning process is gone on this host, so the dashboard clears the stuck row on the next poll. Runs whose meta predates this field are left to the existing boot-time reconcile.
- ca2b719: Resume a finished run by messaging it (#720). After a run ends (Stop, or it finishes) the dashboard used to drop the chat composer, so the conversation was a dead end. The finished-run view now keeps a composer, and sending a message spins a fresh run whose opening prompt `--resume`s the ended run's captured session id, continuing the same conversation with full prior context. New plumbing: `DriverStartOptions.resumeSessionId` seeds the Claude Code session so its very first prompt resumes (the framing is skipped, since the resumed transcript already carries it); `AwaitRoundsOptions.resume` / `RunPromptOptions.resumeSessionId` carry it through `runPrompt`; and it threads from the dashboard as `StartRunOptions.resumeSession` -> the `--resume-session <id>` CLI flag. A continuation is sent as a `prompt` run; a fresh run is byte-identical to before.
- 0faa297: Add the "Add project(s)" install flow to the dashboard. A `POST /api/projects` (guarded like the other state-changing routes) installs The Framework into a repo, or every git repo directly under a folder, then registers each so it shows up in the Projects list; the daemon wires it to install-core. The Projects sidebar gains an "Add" control with a small path form (single repo or "folder of repos"), shown only when the server enables adding. Also fixes `enumerateGitRepos` to detect repo roots via `git rev-parse --show-prefix` instead of comparing `--show-toplevel` to the path, which failed across a symlink (e.g. macOS `/var` -> `/private/var`) and returned no repos.
- 0c922a6: Add `--agent claude|codex`, which picks the agent that drives a run. The Codex driver shipped but nothing selected it, so it was unreachable; now both driver paths (the build itself and the auto-select routing turn before it) honor the flag, and preflight probes the agent you asked for rather than always `claude`. Default stays `claude`.

  Codex reports no price and no quota, so the spend cap and the consumption limits cannot gate it and previously would have no-opped in silence. A run now says which guards are not in force instead of letting `--max-cost` imply one, and it no longer offers a Claude Code session link for a session that isn't Claude's.

- aac6e5d: Add an agent picker to the dashboard (#650). The Start form can now choose the coding agent that drives the run — Claude Code or Codex — alongside the model, wiring the existing `--agent` flag. It persists as a preference (`agent`, validated to the known set) and maps to a run's `--agent` (only non-default `codex` emits a flag). Agent and model share one dropdown (a submenu each), styled like the Presets menu, and the "New preset" panel spans the full width.
- 4788a22: Add a "Browser" toggle to the dashboard Start form so `--browser` (give the agent a real browser via chrome-devtools-mcp, #452) is reachable from daemon/dashboard-started runs, not just the CLI. Mirrors the Post-merge cleanup pref: a `browser` preference flows to `StartRunOptions.browser` and on to the `--browser` flag.
- 9e71fc8: Add `--browser`: give the agent a real browser during the run via chrome-devtools-mcp. When set, the driver writes a temp `--mcp-config` wiring `chrome-devtools-mcp`, so the agent can navigate pages, read console + network output, inspect the DOM, and screenshot while it works instead of flying blind on frontend changes. Off by default; host-side only (no runner change), and the MCP servers merge with the user's own rather than replacing them. The `ClaudeCodeDriver` gains an `mcpServers` option backing this.
- b22337a: Collect business knowledge in the repo (#537). Every run now puts `.the-framework/README.md`, `.the-framework/DECISIONS.md` and `.the-framework/KNOWLEDGE-BASE.md` on the `Context:` line, so the agent reads whatever the project already knows about itself, and the post-merge prompt gained a `## Business knowledge` section asking it to fold back what the session taught that the code cannot show. The docs go with the built-in system prompt: `--vanilla` still injects nothing but the user's own dirs. `--eco-auto-maintenance` now drops the post-merge prompt's `## Maintenance` section instead of skipping the whole run, which would have taken business knowledge with it.
- 558bdb8: Live chat: send more messages to a running run. The dashboard's run view gains a composer, and the run stays open after the agent goes idle to take the user's own messages (the "stay-open" lifecycle) until it is stopped. Each message continues the same agent session via `claude --resume <sessionId>`, so the conversation keeps full context, and rides the existing `control.jsonl` steering channel as a new `message` kind next to Stop and choice picks. Wired only for an interactive run (a live dashboard / daemon); a headless run ends when the agent stops asking, exactly as before. The Claude Code driver gains a `resume` prompt option (`DriverPromptOptions.resume`) that continues the retained session and skips the redundant system-prompt re-append.
- 016fb8d: Bare `framework` now tells you whether the CLI is up to date (#312): after the version footer it checks npm's `dist-tags.latest` (2.5s cap) and prints "Up to date" or "Update available: vX (you have vY). Run: npm i -g @gemstack/framework". Offline or on any fetch failure it prints nothing. Display only; no auto-update.
- 112c3a6: Add `CodexDriver`: The Framework can drive the Codex CLI as a second agent, on the user's own ChatGPT subscription with no API key. Generalizes the agent-CLI process handling into `runAgentCli` so a second agent reuses it rather than copying it. Codex reports no price and no quota, so it omits usage rather than claim a run was free, and the consumption limits stay Claude-only.
- 87d67c8: Turn-boundary gate for plan approval (`showMarkdown()` + AWAIT): a build turn that ends with an `await-confirmation` block (the #326 large-scope PLAN flow) now pauses the run with a green Approve and a red Decline button on the dashboard. Approve resumes the build; Decline logs "Plan declined, awaiting user instructions." and stops the run cleanly (like the budget cap), so nothing reviews or improves work the user just declined. Headless runs auto-approve, keeping programmatic runs deterministic. Try it offline with `FRAMEWORK_FAKE_AWAIT=confirmation`.
- 76c1bfa: Turn the consumption limits on for real runs. `startConsumptionGuard` composes the poller and the limits into the gate a run consults, the CLI reads the limits from the user's preferences and wires it into both run paths, and the direct prompt path gained the same pause the build path got. A driver that can't report a quota leaves the run ungated.
- 6524e0a: Let the user set the consumption limits. The preferences now carry a checkbox and a percentage per limit, and `resolveConsumptionLimits` fills any gap with the defaults. Preference sanitizing was boolean-only, so a percentage was silently dropped on both read and write; it now validates per-limit and falls back to the default rather than leaving the account unguarded.
- d0fe851: Add the consumption-limit decision layer: `ConsumptionMeter` tracks the account's weekly quota meter over time, and `consumptionStatus` reports where the session / 5h / daily limits stand and which one is reached. Handles the weekly reset, reports partial coverage honestly, and fails open when the quota can't be read.
- 9a27125: Pause a run when a consumption limit is reached. `runFramework` takes a `consumptionGate` consulted between turns; a reached limit stops the run cleanly (like the budget cap) and leaves a `Resume <session name>` entry on the workspace's backlog, so a later run picks the work back up. An unreadable quota carries on rather than stopping the work.
- e808793: Expand the run-start context fragment (#683): alongside `DECISIONS.md` and `KNOWLEDGE-BASE.md` the agent now also sees `GOAL.md`, `tickets/**.md` (pointed at the `.the-framework/ticketing-format.md` spec from #684), and the `TODO-AGENTS.md` task queue. The set is split into `CONTEXT_DOCS` (read at start) and the `BUSINESS_KNOWLEDGE_DOCS` subset the agent also updates at merge, so the roadmap/queue pointers are read-only context.
- f61a367: Add the context selector and trust-on-add to the dashboard (#439, part of #314). The Start form gains a "Context" picker — tick the registered repos to focus the agent on, and each becomes one `Context: <dirs>` line in the run's system prompt (the agent can still reach every repo; this just narrows where it looks). Threaded through as a repeatable `--context <dir>` CLI flag and `StartRunOptions.context`. Adding a project now asks "do you trust this repository?" first, warning about prompt-injection risk before the agent is given read access.

  Also hardens the daemon's Telefunc mount: a bare `GET /_telefunc` (which a browser tab issues on reconnect) made telefunc throw an unhandled rejection that crashed the daemon; the mount now catches it and returns 400.

- 06cb0ce: Custom presets (#626): save your own prompts as reusable presets beside the built-in ones. A "＋ Preset" button under the prompt textarea captures the current editor text (or a fresh one) under a name; saved presets render as buttons that load their prompt back into the editor, and each has a delete. They persist in the daemon preferences (`customPresets`), sanitized and capped so a hand-edited registry can't bloat the home file. For the users (Rom, nitedani) who keep hand-crafting high-signal prompts, this makes them one click to re-run.
- 7ca71be: Bare `framework` now runs the dashboard server in the foreground (#456): Ctrl+C stops it, and the server's logs and any errors it throws are visible in the terminal. `framework --daemon` does what bare `framework` used to do, running the dashboard in the background (detached) and returning after printing the convenience commands. If a background daemon is already running, bare `framework` reports its URL and defers instead of fighting for the port.
- 1dbc02a: The daemon can now serve the new Vike + Telefunc dashboard bundle (#405). Opt in with `FRAMEWORK_DASHBOARD=next` (serves the prerendered SPA at `/`, with the legacy `page.ts` at `/legacy`) or `FRAMEWORK_DASHBOARD=legacy` (mounts the Telefunc surface at `/_telefunc` while `page.ts` stays at `/`). Unset keeps today's behavior exactly. The dashboard's read + steer RPCs and the live-event Channel are served in-process at `/_telefunc` (same-origin guarded), backed by a new `@gemstack/framework/dashboard-rpc` subpath; `starting` a run over Telefunc lands next.
- f82e220: Restore the dashboard actions on the new dashboard (#433): the Start form now carries the Global options (autopilot, technical, vanilla, eco) and the run presets (Research, Readability, Maintainability), the interactive choice gate auto-accepts the recommended pick on an autopilot countdown, a Deploy card shows the chosen render + target, and projects can be added from the Projects sidebar over a new `sendAddProject` telefunction. Adds a browser-safe `deployPlan` projection and the preset builders to `@gemstack/framework/client`.
- 18de94b: Let the agent push ad-hoc markdown views into the dashboard right rail. A `show-markdown` block in a turn (non-blocking, unlike a choice gate) becomes a `view` event that renders as a first-class Views tab in the right rail, with a sticky top-nav to jump between views. Re-showing the same title updates that view in place.
- 27f522a: feat(framework): opt-in browser notifications on the dashboard for run-end and choice gates (#317)

  The localhost dashboard can now notify you when a run finishes (or fails/stops) and when a run reaches a `<Choices>` gate that needs your input (e.g. a PLAN.md approval). Opt in via the header bell; it only nudges when the dashboard tab is backgrounded, so a run you are watching stays quiet.

- 4ed510f: Dashboard control channel: the persistent daemon dashboard can now steer any run in its workspace. Its Stop button and choice picks append to `.framework/control.jsonl`; the run tails the file and aborts or resolves its parked gate. Gates now pause whenever a workspace daemon is live, not only when the run owns its own dashboard; headless behavior without a daemon is unchanged. Also fixes the fresh-workspace daemon startup: bare `framework` in a project with no `.framework/` yet used to fail and leave a zombie server on the port.
- a345a83: The new Vike + Telefunc dashboard (#405) is now what the daemon serves by default at `/`; the legacy `page.ts` dashboard moves to `/legacy`. Set `FRAMEWORK_DASHBOARD=legacy` to keep `page.ts` at `/` (the escape hatch), and if a build ever ships without the prerendered bundle the daemon falls back to `page.ts` automatically. The `release` flow now runs `bundle:dashboard` so the published package ships the dashboard assets.
- 63b2a73: feat(framework): document sidebar on the dashboard, rendering the run's PLAN.md / TODO.md (#319)

  The localhost dashboard now surfaces the `PLAN.md` and `TODO.md` the agent writes at the workspace root (via the anti-lazy-pill) in a right sidebar, rendered as markdown with a sticky tab nav to jump between them. A new `GET /api/docs` endpoint reads the surfaced docs (fixed filenames, gated on the workspace `cwd` like `/api/runs`); the sidebar polls it so a plan written mid-run appears, and stays hidden when there are no docs.

- 1bb66cf: Add a preferred-editor dashboard preference (#727). "Open in editor" now uses a stored `editor` preference (an editor CLI such as `code`, `cursor`, or `zed`), falling back to `$FRAMEWORK_EDITOR` and then `code` as before. The Settings gear offers a picker that auto-detects the editors installed on the daemon's machine by probing their launchers on PATH (`onEditors`), plus a "Default" entry to clear the choice. A public host, which has no local checkout to open, detects nothing.
- 3091bc2: Add an Overview section to the top of the dashboard's first sidebar. It gives a cross-project glance over a new `onOverview` Telefunc read: what the agent is running right now (from each project's live run meta), the total open TODO count across all projects, and the most recently active projects. Clicking any of them selects the project.
- 44988d7: Move the cross-project Overview out of the first sidebar and into a proper dashboard page. The sidebar is now just an "Overview" nav item plus the project list, so it reads as a simple switcher. Selecting Overview (or opening the dashboard with no project picked) shows an at-a-glance landing: KPI tiles (projects, active runs, open TODOs, total runs), a two-week run-activity chart, how past runs ended, what the agent is working on now, the TODO backlog, and a projects table. It is backed by a new `onDashboard` read (a projection of the same run.json / runs/ / TODO files), so nothing new is stored.
- dabdf0f: Default dashboard port is now 4200 (was 4477): easier to remember. Pass `--port` to override.
- c26159d: Persist the dashboard's Global options (Autopilot, Technical, Vanilla, Eco) in the same `the-framework.json` as the project list, read and written daemon-side over Telefunc (`onPreferences` / `savePreferences`), so they survive restarts without localStorage (#410). The registry file becomes an object `{ projects, preferences }`; older bare-array files still read and are migrated on the next write.
- 16e86c4: Add a Project log panel to the dashboard (#384). It surfaces the committed `.the-framework/LOGS.md` history (#378/#379) for the workspace: every loop/prompt/build run with its title, status, kind, session link, and a loop's constituent prompts, newest-first. Served by a new `GET /api/logs` endpoint and refreshed on load, on run-end, and on an interval. All fields are escaped and the session link is passed through the page's safe-URL guard, since the log is agent-authored.
- 43d4f50: Add a cross-project Queue section to the dashboard's first sidebar. It aggregates the open `TODO.md` items across every registered project over a new `onQueue` Telefunc read, so the whole backlog is visible in one place instead of per-selected-project only. Clicking a project in the queue selects it.
- 90c15bf: Export `readDocs` + the `WorkspaceDoc` type from the package root, so a separate dashboard can read the same surfaced PLAN/TODO docs the daemon serves (#405 phase 2).
- 388f3ad: feat(framework): browse a project's run history in the dashboard (#303)

  The dashboard now has a left sidebar listing a project's past runs (intent, status, session link); clicking one replays that run's projection in the main view, and "Back to live" returns to the current run. Each finished run is archived under `.framework/runs/<id>.jsonl` + `.framework/runs/<id>.json` (a crash that skips the final flush is archived on the next run), and served over `GET /api/runs` and `GET /api/runs/<id>`. Single project only. Closes #303.

- 48f25cd: Add event-stream projections for the dashboard's run overview: `loopStatus` and `sessionInfo` derive the production-grade loop status and the live session from a `FrameworkEvent[]`. They plus `formatFrameworkEvent` are re-exported from a new browser-safe `@gemstack/framework/client` subpath (no Node imports), so the dashboard renders the rich run view (loop status and a human-readable event log instead of raw JSON) across the live view, past-run replay, and the relay watch view.
- 4e43d76: The new dashboard can now start a run over Telefunc (#405). A `sendStart` telefunction reaches the daemon's own `startRun` closure through the Telefunc request context, so it runs in-process with the one-run-per-project busy guard intact (a second start returns `busy`). Served at `/_telefunc` alongside the read + steer RPCs, same-origin guarded.
- 72fb351: Start runs from the daemon dashboard (#345): a prompt textarea + `POST /api/start` that spawns `framework "<prompt>" --no-dashboard` as a detached child, with a one-run-at-a-time guard. The started run streams into the page via the tailed event log and is steerable (gates + Stop) through the control channel.
- f9add6d: Add a `theme` dashboard preference (#725): `system` (the default, following the OS), `light`, or `dark`. Stored in `the-framework.json` alongside the other preferences and sanitized against the known set. The dashboard applies it by toggling the `.dark` class (following live OS changes while on `system`) and exposes a system/light/dark picker in the Settings gear, replacing the previously hardcoded dark-only mode.
- e4b38b3: Per-user Discord toggle for the "needs you" notifications (#627): Discord was env-only (set `DISCORD_WEBHOOK` and it posted). Now a `notifyDiscord` preference (default off) gates the daemon watcher on top of the webhook — the webhook is _where_ to post, the preference is _whether_ to. It is checked at post time, so the new header toggle (beside the browser bell) takes effect without restarting the daemon, and the watcher keeps its baseline warm while off so flipping it on starts from now rather than blasting the open backlog.
- affa3d8: Add `#` to the dashboard prompt editor to reference a project file as run context (#504). The finer-grained sibling of `@` (which focuses a whole repo): type `#` to filter the project's files (via `git ls-files`, honoring .gitignore) and pick one, inserting a chip that adds its repo-relative path to the run Context. Backed by a new `onProjectFiles` read RPC; localhost-only, since the relay has no checkout.
- 1f588aa: Add `framework maintain` (#298): a background maintenance sweep. It walks the registered repos, and for each that has grown commits since its last review it runs the maintainability loop on them (`framework prompt`, budget-capped by `--max-cost`, bounded by `--max-repos`). A first-seen repo is baselined (recorded, not reviewed retroactively); per-repo review state lives in `.the-framework/maintenance.json`. `--dry-run` previews the plan. Also exports the maintenance API (`assessRepo`, `planMaintenanceSweep`, `maintainSweep`, review state helpers).
- 5882932: feat(framework): inject a system prompt into every prompt (anti-lazy-pill + SYSTEM.md)

  Every run is now framed with a built-in system prompt: the validated anti-lazy-pill (#297), which turns unclear scope into a ranked list, a large scope into a `PLAN.md`, and a very large one into a `TODO.md` backlog, so the agent builds a real backend and declares what it descopes instead of silently faking it. Drop a `SYSTEM.md` at the workspace root to add project-specific instructions on top, or set `antiLazyPill: false` in `the-framework.yml` to remove the built-in default. Closes #301.

- eec009d: Thread the #314 Global options through the run engine (#370). `POST /api/start` now carries an `options` object which the daemon turns into CLI flags: `--vanilla` removes the built-in #326 system prompt entirely (raw Claude Code), and `--eco-auto-planning` / `--eco-auto-research` / `--eco-auto-maintenance` drop the matching #326 sections to save tokens (Autopilot and Technical keep mapping to modes). `system-prompt.ts` drops the Eco sections at render, so the #343 Prompts panel reflects the toggles live; the #326 template stays byte-identical. The dashboard panel that drives these lands separately (#371); all fields default off, so today's behavior is unchanged.
- 5d54b64: Add the #314 Global options panel to the dashboard (#371). Beside the Start box the daemon dashboard now shows persistent toggles: Autopilot (auto-accept, sharing its key with the choice-panel toggle so the two stay in lockstep), Technical control, Vanilla (remove all system prompts, fully transparent), and Eco with Auto planning / Auto research / Auto maintenance to trim the built-in prompt. Each persists in localStorage and rides along in the `POST /api/start` body, so flipping a toggle changes what the run gets (and, with the engine plumbing in #370, what the #343 Prompts panel shows). Vanilla disables Eco, since a removed prompt has nothing left to trim.
- 99229db: Make the "Needs you" (human intervention) notifications a real toggle (#627). It was always-on before; now it is a default-on `notifyHumanIntervention` preference, so it can be turned off like the other categories. Gates both the browser notification and the daemon's Discord delivery on the category (default on) in addition to the delivery method.
- 1f6a0d3: feat(framework): interactive choice gate + autopilot in the dashboard (#304)

  A run can now pause on a choice and wait for you: the dashboard shows a "Your call" panel with the options. Accept with the button or Ctrl+Enter, or leave the `[x] autopilot` countdown auto-accept the recommended option after 10s (moving the mouse cancels it). New `requestChoice` option on `runFramework`, `choice` / `choice-resolved` events, and a `POST /choice` dashboard route; a headless run with no handler auto-accepts the recommended option, so nothing else changes. Closes #304.

- b183dc0: Add the `setSessionName()` and `setReadyForMerge()` lifecycle signals (#326). Both are non-blocking turn-boundary signals, the same shape as the existing `show-markdown` view: the agent emits a fenced `set-session-name` / `ready-for-merge` block and keeps working, and the framework records it and reflects it in the dashboard. `setSessionName(<name>)` labels the run with the `[a-z0-9-]` slug it chose (also its `the-framework/<name>` branch); `setReadyForMerge()` flips the run's status from building to ready-for-review. The dashboard shows the session name and a status dot (amber while building, green once ready) in both the run overview and the cross-project "working now" list. This is the signal the post-merge quality suite will hang off.
- aa5870e: Dashboard: show the live run in the Runs rail with a RUNNING status. The in-progress run now appears as the top row of the list (pulsing dot, RUNNING badge, and the prompt), matching the history rows, instead of being hidden behind the abstract "Live" button; clicking it follows the live stream as before. `onRuns` prepends the live run (from `run.json`) when one is running, and the Start form seeds an optimistic row so the run shows the instant you click Start, before the spawned process writes its `run.json`.
- 28fff61: New [Maintainability] preset button on the dashboard (#361): prefills the deliberately minimal refactor-for-future-changes prompt ("look for maintainability red flags, and fix them") into the start textarea for review or editing; Start runs the text verbatim as a direct prompt run. The one blank, `<PARAM:what>`, defaults to `this PR`.
- 4aaa00a: Make the dashboard multi-project on the read side: `GET /api/projects` lists the registered projects (from the registry) with a per-project summary (name, activated, last activity), and `?project=<id>` on `/api/logs`, `/api/runs`, `/api/runs/<id>`, and `/api/docs` reads that project's data (an absent id keeps the daemon's own workspace, single-project back-compat). The daemon auto-registers its own workspace on boot when it is activated, so the Projects list is populated for the common single-project case. Live event streaming and per-project run start/stop stay single-project for now. Adds `ProjectSummary` / `ProjectsProvider` / `summarizeProject` / `defaultProjectsProvider`.
- f0a024c: Add the install-core module: `installProject(cwd)` activates a repo for The Framework by creating the `.the-framework/` marker with a seeded `LOGS.md`, committing any pre-existing dirty changes first (`[The Framework] uncommitted changes`) so the install commit (`[The Framework] install The Framework`) is clean; an already-activated repo is a no-op. Also `enumerateGitRepos(dir)` lists the immediate child directories that are their own git repo roots (for the "add a directory of repos" flow). Pure core over the existing `GitRunner` + `StoreFs` seams; any git failure surfaces as a value, never a throw. No daemon or UI wiring yet.
- 4746188: Add the multi-project registry module: reads and writes the list of projects The Framework is installed into, as a small `{id, path, addedAt}` JSON index under the user's config dir. Exposes `projectId`, `registryPath`, `listProjects`, `addProject`, `removeProject`, and an injectable `RegistryFs` seam with a `nodeRegistryFs()` adapter. No daemon or UI wiring yet.
- f496a54: Add a multi-select gate (`showMultiSelect()`): a dashboard checklist with pre-checked defaults that pauses the run and resolves to the selected subset. Built on the existing single-select choice gate (same panel and POST-back resolver), exposed as `requestMultiSelect()`; a headless run auto-accepts the default set. This is the primitive the [Research] preset uses to let the user pick which problems to deep-dive.
- e370b41: feat(framework): turn an agent's showMultiSelect()+AWAIT into a live checklist gate (#339)

  The multi twin of the single-select turn-boundary gate (#337). When a build turn ends on an `await-multiselect` block, the framework shows a checklist on the dashboard (via `requestMultiSelect`, with the agent-marked defaults pre-checked), waits for the selection, and re-prompts the agent to continue from it. This is what the research preset needs to let the user pick which problems to deep-dive. Same safety as #337: a no-op when headless and when the agent just finishes.

- 164771a: Discord delivery for the "New activity" notifications category (#627): the daemon now also watches the run activity feed and posts to Discord when a run starts or finishes, so the default-off activity category reaches you with no dashboard open — the same path the interventions watcher uses for the "needs you" queue. Double-gated at post time so the header toggles take effect without a daemon restart: both the category (`notifyNewActivity`) and the Discord method (`notifyDiscord`) must be on, on top of a `DISCORD_WEBHOOK` being set. The runs already going when the daemon starts are folded into a baseline (no start-up blast). Completes the browser + Discord matrix for both notification categories.
- 4d456c2: "New activity" notifications (#627): a default-off notification _category_ alongside the always-on "needs you" one. Turn it on (the new Activity toggle in the header, beside the browser bell and Discord toggle) and you get a ping when a run starts and when it finishes, not just when something needs you. It is a category, not a method, so it rides whichever delivery methods are on: browser notifications when the bell is on. A cross-project `onActivity` feed (`buildActivity`) drives it, diffed the same way as the interventions queue, so the runs already going when the page loads are folded into a baseline rather than announced.
- a743cd4: Report an agent's tokens when it reports no price. `DriverUsage.costUsd` is now optional: tokens are what every agent reports, a price is what only some do. Codex reported real token counts that we were dropping on the floor, and now surfaces them; a run with no price shows `tokens: 13,570 (5 out)` rather than nothing at all, and never a `$0` that would read as free. Claude runs are unchanged and still show their spend line.

  The spend cap only ever fires on a reported price, so it stays Claude-only and the CLI says so rather than implying otherwise. We deliberately do not invent prices from a model table: that number would go stale silently, and under a subscription nobody is billed per token anyway. What a subscription actually spends is quota, which the consumption limits gate on.

- 72533fc: Add a file tree to the dashboard's project panel (#492). It lives as the first tab in the right rail (Files · Docs · Log) and is a file-level context picker: a lazy, collapsible tree (animate-ui Files) built from `git ls-files`, where ticking a file adds it to the run Context — the same set the `#` picker and whole-repo Context selector feed. Per-file git-status dots (untracked/modified/deleted) come from a new `onProjectFileStatus` RPC, rolled up to folders.

  Also refines the project action bar: git status folds inline on the left; Open on GitHub / Open folder / Open in editor become icon-only buttons with tooltips (a small Base UI Tooltip, no Radix added); and Preview is renamed Serve — a play button that becomes a segmented Open ↗ / Stop ⏹ control while serving.

- 7e1ea76: Per-project daemon runs + one daemon per machine (#393). Dashboard-started runs, Stop, and choice picks now carry the viewed project id, so the daemon spawns each run with that project's `--cwd`, steers it through that project's own control log, and guards one run per project. Daemon liveness moved from a per-workspace `.the-framework/daemon.json` to a single global file beside the registry (`$XDG_CONFIG_HOME/the-framework-daemon.json`), so `framework` and `framework stop` in any repo find the same daemon. Per-project live event streaming is folded in with the dashboard rebuild (#405).
- 5709703: Serve the new Vike + Telefunc dashboard for per-run foreground runs and `--resume`, not just the daemon. `framework "<prompt>"` and `framework --resume` now serve the rebuilt dashboard in single-project mode, scoped to that run's workspace without touching the global registry, and the live run steers over its own `.the-framework/control.jsonl` even with no daemon running. Falls back to the legacy `page.ts` when the bundle is absent or `--no-persist` is set. Adds `singleProjectProvider` and `resolveDashboardBundle` to the public surface.
- 21fe373: feat(framework): persistent background dashboard daemon (#302)

  Bare `framework` now ensures a long-lived dashboard process for the workspace and prints its URL plus the convenience commands; `framework stop` shuts it down. The dashboard is a projection of `.framework/events.jsonl`: the detached daemon tails the log and pushes each new event to connected browsers, so it outlives any single run. The tailer also detects an in-place truncation when a fresh run rewrites the log to the same byte length (size unchanged but mtime advanced), and the daemon spawn refuses to re-exec a test entry so a `node --test` run can never fork-bomb itself.

- 89cedff: Add the post-merge quality suite (#326): when a run signals `setReadyForMerge()`, optionally fire the maintainability, readability, and security-audit passes over the same workspace. Enabled per run by the new `--post-merge` CLI flag, or from the dashboard's Global options via a "Post-merge cleanup" toggle (persisted as the `postMergeQuality` preference, mapped to `--post-merge` on the spawned run). The three passes run **sequentially** — they edit and commit the same git tree, so concurrent writers would race on the index lock; worktree-isolated parallelism is a follow-up. Each pass is a plain `framework prompt` child carrying no `--post-merge`, so a quality pass never triggers its own suite. Off by default.
- cfdbd59: Post-merge now queues the quality follow-ups instead of running them (#556), which is what the #326 doc says and what composes with the backlog loop (#323/#538). On `setReadyForMerge()`, a `--post-merge` run used to fire maintainability, readability and security-audit as three child `framework prompt` runs back to back, on the spot. It now fires one short turn that appends "Apply preset X on the changes introduced by <session>" entries to the session's TODO file, and lets the loop pick them up. Cheaper by a lot: a few TODO lines rather than three full preset passes serialized on the same git index.

  The readability entry is gated on Technical control, per the doc. That setting already existed as a preference, a `--technical` flag and a Global options toggle; it just never reached the prompts, so `TfContext` gains `settings.technical_control` and `session_name`. The session name is carried on run state: the agent sets it before its first change and the post-merge prompt reads it afterwards.

  `--eco-auto-maintenance` does something again. #326 moved the maintenance section out of the system prompt, which left the flag inert (#555); the post-merge prompt is exactly that section, so the flag now skips it.

  The post-merge prompt is flattened rather than verbatim from the doc, and this is the one place the prompts depart from it. The doc nests `${{ tf.session_name }}` inside the outer `${{ ... }}` and puts backticks inside a backtick template literal; the fragment regex is non-greedy, so the outer fragment closes on the inner `}}` and what is left is not valid JS. It throws `TemplateFragmentError` today, with or without the new context fields. Same branch, same output, one fragment, and a test now rejects any nested fragment so the prompt cannot regress into a shape that will not render.

  `POST_MERGE_PASSES` and `runPostMergeSuite` are replaced by `runPostMerge` and `renderPostMergePrompt`. The three preset modules are untouched: the dashboard buttons still use them.

- 5bd0489: Post-merge TODO entries now carry the preset's `filePath` instead of a bare preset name (#326). The entry reads `Apply .the-framework/presets/<name>.md with tf.params.what set to "changes introduced by <session>"`, and `installProject` materializes the presets into `.the-framework/presets/*.md` so that path resolves to a real file the picked-up agent opens. Closes the fidelity gap where the queue sent a preset name and the agent had to guess the prompt. The materialized presets are gitignored (regenerated on install, tracking the framework version). New: `PRESETS`, `PRESET_DIR`, `presetFilePath`, `presetContext`, `materializePresets`.
- 721f539: Add preset-prompt param substitution (`<PARAM:name>`), the foundation for prompt-preset buttons. A preset prompt template can carry `<PARAM:name>` placeholders substituted from supplied values or declared defaults; unfilled params are surfaced so a caller can ask the user to fill the blanks.
- db95caa: Standardize the preset prompts on the `${{ tf.params.what }}` fragment syntax (the same the system prompt uses) and retire the bespoke `<PARAM:name>` primitive. `render<Name>Prompt(what)` is unchanged and produces byte-identical output; the removed exports (`renderPresetPrompt`, `PARAM_PATTERN`, `extractParamNames`, `unfilledParams`, `PresetParamError`, `PresetParam`, `PresetParamOptions`) had no other consumers. Prereq for #326's post-merge preset `filePath` entries.
- d834af8: Dashboard presets only prefill the textarea (#353): the [Research] button now loads the full rendered preset prompt for review and editing, and nothing runs until Start / Ctrl+Enter. The edited text is sent verbatim via a new `prompt` start kind and `framework prompt <text>` subcommand (the direct path: gates honored, no build pipeline). Clearing the box reverts Start to a normal build run.
- c4a992a: Add a dashboard **Preview** button (#475): serve a project's built result on demand, decoupled from an agent run. One click runs the project's dev script (`dev`/`start`/`preview`/`serve`) and surfaces the live localhost URL it announces, with a **Stop** to tear it down; a project with a plain `index.html` and no dev script is served by a built-in static server instead. The preview lives in the daemon (one per project, idempotent to open) and is torn down on daemon shutdown; the button rehydrates after a reload. A preview that exits on its own (a crash, a build error) is evicted so the next open restarts it rather than handing back a dead URL. Exposed as three Telefunc RPCs (`sendPreview` / `sendStopPreview` / `onPreviewStatus`) and the `startPreview` helper.
- b7de2a1: Add a git-status line to the dashboard project panel: the active branch, a clean/dirty indicator, and the linked PR (number, state, link). Backed by a new `onGitStatus` read; branch and dirty come from git, the PR is a best-effort `gh` lookup that degrades to nothing when gh is missing/unauthed or there is no PR. Hidden when the project is not a git repo.
- 3f12815: Add "Open folder" and "Open in editor" buttons to the dashboard project panel (localhost-only). The daemon spawns the OS file manager (open / xdg-open / explorer) or an editor (the `code` CLI, or `$FRAMEWORK_EDITOR`) on the project's own path. A missing command surfaces a friendly error. Safe on a public host: no local checkout to resolve, so nothing is spawned.
- 4067614: Add an "Open on GitHub" button to the dashboard project panel. When the repo has a github.com `origin` remote, the panel shows a one-click link to it (backed by a new `onGithubUrl` read that normalizes the ssh/https remote forms). Hidden when there is no GitHub remote, so it never shows empty.
- 5108aea: Add the per-project second sidebar and main view. The second sidebar now shows the selected project's loops/prompts (its `.the-framework/LOGS.md`, scoped via `?project=<id>`) with its Runs archive below it, both following the selection. The main view shows the selected or latest loop/prompt claude.ai/code-style (kind, title, status, session link, and a loop's constituent prompts); clicking a loop in the sidebar opens it. On load the most recently active project is auto-selected, so the view is populated immediately.
- 32e9d3e: Add the Projects sidebar to the dashboard: a leftmost nav with Overview (project count plus the most recently active projects), Projects (every registered project with an activation dot and last-activity, from `/api/projects`), and Queue (the open TODO items aggregated across all projects). Selecting a project re-points the project log to `?project=<id>`. The per-project second sidebar and main view come next.
- c48af6d: Queue "needs you" now surfaces paused runs, not just PRs (#636, part of #624): a live run that stopped mid-flight to ask a question shows up alongside open PRs in the Overview card, the sidebar badge, and the #627 browser + Discord notifications. `RunMeta` folds a `pendingChoice` from the `choice`/`choice-resolved` events, and `Intervention` gains a second `kind: 'awaiting'` — the card jumps into that project to answer, and the Discord message reads "awaiting your answer" with a link back to the dashboard.
- 96870d2: Discord notifications for the Queue's "needs you" list (#627): when `DISCORD_WEBHOOK` is set, the daemon watches the interventions queue and posts a message when a new PR lands — so you are notified even with no dashboard open. The PRs already open when the daemon starts are folded into a baseline (no start-up blast); the env var is the opt-in. Complements the in-browser notifications from the same queue.
- 9d1951b: Add the Queue's cross-project "needs you" projection (#632, part of #624): `buildInterventions` rolls up every registered project's open, non-draft PRs (via `gh pr list`, degrading to empty with no remote / no gh), newest first, and exposes them over a new `onInterventions()` dashboard read. This is the first slice of the interventions queue — proposals and finished work both surface as PRs to review or close.
- 5d1653b: Browser notifications for the Queue's "needs you" list (#627): when a new PR lands on the interventions queue, the dashboard fires a browser notification that opens the PR on click. A bell in the header toggles it and requests permission; the preference (`notifyBrowser`, on by default) persists with the others. Existing PRs at page load are folded into a baseline, so you are only told about items that appear while you are watching. (Discord delivery and the paused-run trigger are follow-ups.)
- d10d515: Serve the usage panel's numbers: an `onQuota` RPC returning the account's quota windows plus where the consumption limits stand, backed by a quota source the daemon polls for its whole life (the per-run guard dies with its run, but the panel has to show the account while nothing is running). A host with no agent to ask reports it has no reading rather than an empty one.
- 18c9352: Add `QuotaPoller`: keeps the account's quota reading fresh on a slow timer and feeds the consumption meter. Backs off when the agent's usage fetch is refused rather than retrying into the penalty window, gives up on an authoritative failure, and keeps the last good reading across a transient one.
- cbe1898: Read the account's subscription quota on demand via the agent's own `/usage` command, as `Driver.readQuota()`. Reports the percentage of each window consumed (session, week, per-model week), which is what a consumption limit needs and what the per-turn rate-limit telemetry could not give. Costs no tokens, and the CLI reaches Anthropic with its own credentials, so The Framework never handles the user's token.
- 68d0df4: Capture the agent's rate-limit telemetry. Claude Code reports where the account's subscription quota stands on every turn of its `stream-json` output, and the parser was dropping it. It now surfaces as a `rate-limit` driver event carrying the status, the quota window, and when that window resets, so it persists and reaches the dashboard like any other driver event. New `DriverRateLimit` type.
- f736b55: New [Readability] preset button on the dashboard (#360): prefills Rom's refactor-for-human-readers prompt (architectural seams, linearity/altitude pass, exhaustive per-function rating lists, one commit per refactor) into the start textarea for review or editing; Start runs the text verbatim as a direct prompt run. The one blank, `<PARAM:what>`, defaults to `this PR`.
- 632f0df: Serve the new Vike + Telefunc dashboard from the run relay (`--share`), in a read-only watch mode. The relay now serves the prerendered SPA and streams events over the same Telefunc `onEvents` Channel the daemon uses, sourced from its in-memory run instead of a file. Only the live event stream is exposed (an empty projects provider neutralizes the file/registry RPCs on the public host, and no run can be started or steered). The shareable viewer URL moves from `/r/:id/` to `/?run=:id` (old links redirect); ingest stays at `/r/:id/publish`. This removes the relay's dependency on the legacy `page.ts`. Adds `makeTelefuncMount`, `serveClientBundle`, `emptyProjectsProvider`, and the `EventsSource` type to the public surface.
- 9442761: Remove the architect. A build no longer runs a turn to pick the app's stack, and no longer tells the agent what to build on: the agent reads the workspace and decides for itself, the same way it would outside The Framework. `buildPrompt` / `extendPrompt` / `scaffoldPrompt` now take just the intent and say nothing about a stack.

  Being opinionated about the stack is a hard thing to do well, and a system prompt that nudges one is worse than none at all (#545). The stack guidance we had was not designed, it accumulated. It goes rather than half-ships.

  Gone with it, because the architect was their only source:

  - the plan-approval gate ("Approve this plan?" / "Use X instead") and re-architect. The agent-authored await gates a build turn raises are unaffected: a build that stops to ask still pauses the run with Approve / Decline.
  - the decisions ledger in a run, and the `DECISIONS.md` a run wrote from it. `@gemstack/ai-autopilot`'s `decisions/` module is untouched and still exported; nothing in a run feeds it now.
  - the dashboard's "Stack & rationale" and "Decisions ledger" panels. Loop status, deploy, and session cards are unchanged.
  - `@gemstack/ai-autopilot`: `agentArchitect`, `STACK_TRADEOFFS`, `BootstrapSteps.architect`, `BootstrapOptions.ledger`, the `architect` bootstrap event, `ArchitectPlan` / `ArchitectContext` / `ArchitectDecision` / `ArchitectAlternative`, and the `plan` field on the build / loop / deploy contexts and on `BootstrapResult`. The flow is now scope -> build -> loop -> deploy.
  - `@gemstack/framework`: `driverArchitect`, `reArchitect`, `architectPrompt`, `parseArchitectPlan`, `architectPlan`, `decisionLedger`, `RunFrameworkResult.ledger`, and the `bench:architect` benchmark.

- eb1a0f1: Remove AI meta-select. A run no longer spends an agent turn guessing which Open Loop domain preset, modes, and build event kind to run under; a preset is used only when you ask for one with `--preset` or `the-framework.yml`, and otherwise the plain framework flow runs.

  The routing turn injected a prompt of its own before the build started, which meant part of what the agent ran under was chosen mid-run by another model rather than by the user (#545). Removing it also makes a run's prompt knowable before it starts.

  Gone with it: the `--no-auto-preset` flag (there is nothing left to opt out of), the `autoSelectPreset` / `workspaceSummary` / `metaSelect` / `presetCatalog` / `parseMetaSelection` / `META_SELECT_*` exports, and the `bench:meta-select` benchmark.

- 5e24797: Remove the persona, skill, and project-memory framing. A run's system prompt is now the built-in #326 prompt plus your own `SYSTEM.md`, and nothing else. Nothing is read off disk and appended when the run starts.

  A build used to append the personas and skills for its detected stack plus the full contents of the repo's memory files. On one measured 8,852-character build prompt that framing was about 5,000 characters, more than the designed prompt it was wrapping. None of that text was designed; it accumulated. Prompt text nobody reviewed is a defect, not a feature (#547).

  Two things fall out of this:

  - **The prompt preview is now exact.** The dashboard's "See actual prompt sent" (#520) had to carry a caveat that a build run appends more at run time. It no longer does, so the caveat is gone and what you read before the run is what the agent gets, for every run kind.
  - **A build stops being opinionated about the stack.** #545 removed the architect turn, but the personas still hard-instructed a stack ("Default to Prisma"). With both gone, nothing tells the agent what to build on.

  Skills and project memory are worth having as designed features later. They are not worth keeping in this shape.

  Removed from `@gemstack/framework`: the `memory` / `extensions` / `composeExtensions` options on `runFramework`, the `framing` option on `composeRunSystem` (`RunSystemOptions` is now `SystemPromptOptions`), `loadRepoMemory` / `memoryFraming` / `MEMORY_FILES`, `discoverExtensions`, and the `--compose-extensions` flag. `readProjectSignals` moved to `project.js` and is still exported from the root; preset detection still runs and still narrates `Detected <framework>`.

  Removed from `@gemstack/ai-autopilot`: the `personas/` and `extensions/` modules (`definePersona`, `composePersonas`, `personaInstructions`, `personaTools`, `personaAgent`, `personaWorkers`, `personaRoster`, `stackPersonas`, `neutralPersonas`, `presetPersonas`, `defineSkill`, `SkillRegistry`, `composeSkills`, `skillInstructions`, `FrameworkExtension` and its registry). `Preset` is now `{name, framework, signals}`, a pure detector; `DomainPreset` loses `skills` and keeps its loops, prompts, and modes.

  `@gemstack/ai-skills` is untouched. It is a different thing (an on-disk `SKILL.md` loader for ai-sdk agents) and is unaffected by any of this.

- dac7613: Rename the "post-merge" prompt to "on-before-mergeable" (#592). It fires on `setReadyForMerge()`, before the merge, so "post-merge" was a misnomer (Rom's call in #559). Renamed end to end: the `--post-merge` flag is now `--on-before-mergeable`; `runPostMerge` / `renderPostMergePrompt` / `PostMergeContext` / `POST_MERGE_PROMPT` become their `OnBeforeMergeable` equivalents; the prompt file is `on_before_mergeable_prompt.md`; and the dashboard preference key `postMergeQuality` is now `onBeforeMergeableQuality` (a saved toggle resets to its default once). No agent-facing prompt text changed: the string "post-merge" never appeared in any prompt. The dashboard's visible "Post-merge cleanup" label is left as-is pending a copy decision.
- 7f9c514: Rename the flat backlog file from `TODO-AGENTS.md` to `TODO_AGENTS.md` (#674): underscore is the more standard convention (per Rom's "convention over proprietary" call). New backlogs are created at `TODO_AGENTS.md`; the brief hyphen spelling is still read as a fallback so no repo loses a backlog, alongside the existing `tickets/TODO.md` and root `TODO.md` fallbacks. Also expands the `GOAL.md` context gloss to match the revised #683.
- 98f44e2: The [Research] preset (#331): `framework research [what]` and a [Research] button on the daemon dashboard run Rom's problem-variability review as a direct prompt via the new `runPrompt()` path, which honors await gates (showChoices/showMultiSelect) but skips the scope/build scaffolding. The "what" defaults to `this PR`.
- aafbb55: Retire the legacy `page.ts` dashboard and its HTTP routes (#426, part 3). Both consumers are now on the new Vike + Telefunc dashboard (the daemon default, per-run/resume, and the relay), so `startDashboard` now serves only the prerendered SPA plus the `/_telefunc` mount (RPCs + the live-event Channel). Removed: the `dashboardHtml` and `parseStartOptions` exports, the in-process `Dashboard.push`/`Dashboard.stream` (the SPA reads `events.jsonl` over the Channel and steers over `control.jsonl`), and the now-unused `DashboardOptions` fields (`onStop`, `onChoice`, `cwd`, `dashboardMode`) and the `FRAMEWORK_DASHBOARD=legacy` escape hatch. A `--no-persist` foreground run (or an install missing the built bundle) now runs headless rather than falling back to the old page.
- 43d7fa0: Add the [Security audit] preset (#461): an exhaustive, direct security pass over a target (defaults to `this PR`), shipped alongside [Research], [Readability], and [Maintainability]. It lists every aspect considered with a per-aspect verdict and fixes each issue in its own commit. Available as a dashboard Start-a-run button and exported as `renderSecurityAuditPrompt`. It is also the third of the post-merge quality prompts #326 fires on `setReadyForMerge()`.
- b8c45a7: Let the user see the system prompt. Under the prompt editor, a `▶ See actual prompt sent` toggle shows the built-in prompt in full, with the `Vanilla` checkbox renamed to `Disable system prompt` (nobody knows what "Vanilla" means; the persisted `vanilla` key is unchanged). The preview renders through `composeRunSystem`, the same function a run composes with, so the toggles are shown doing what they really do.

  The event log now renders the run's `system-prompt` event in full too. That event has always carried the exact text handed to the agent, and the dashboard was reducing it to a char count and dropping the rest, so the true prompt was already reaching the browser and being thrown away.

  Reading the user's `SYSTEM.md` moves to `system-prompt-file.ts`, leaving `system-prompt.ts` free of Node imports so the composition can be imported in a browser. A test walks the compiled client barrel's import graph and fails if anything reachable from it imports `node:*`.

- 4d4d77c: Select the model from the dashboard (#628): a model picker sits under the prompt textarea (Default / Opus / Sonnet / Haiku) and persists as a `model` preference. It flows through as the run's `--model`, so the wrapped agent runs on the chosen model; empty means the driver's own default (no flag). A full model id set directly in the registry works too — the aliases are just the common Claude Code ones, since it is the default driver.
- 68d53ff: Serve action: pick a server in a multi-package repo (#651). The dashboard's Serve button previously ran the first `dev`/`start`/`preview`/`serve` script from the repo root, which serves nothing (or the wrong thing) in a monorepo where the apps live in workspace packages. It now lists the servable apps across the repo, the root plus each workspace package that has a serve script (resolved from `pnpm-workspace.yaml` or the package.json `workspaces` field), and offers a picker when there is more than one. The daemon remembers the last pick per project so re-serving is one click. A single-app repo is unchanged.
- 8910ed3: Show the exact prompt sent to the agent each turn. The run feed used to render a turn's start as just `> prompt sent` and drop the text; now the terminal/log formatter shows a one-line preview, and the dashboard event feed renders the full prompt in a collapsible block (click to expand) for both live runs and replays. The prompt was already carried on the driver `start` event and persisted, so this is a display-only change that surfaces it.
- 03ca1b0: Show the real prompts on the dashboard (#343). The framework now emits the exact system prompt it runs the agent under as a `system-prompt` event at session start (both the direct-prompt path and the full build path). A new "Prompts sent to Claude Code" panel renders it alongside each turn's user prompt (harvested from the `driver` `start` events already in the stream), so the normally-hidden prompt is fully visible for transparency. Prompt text renders as inert text, never markup. Read-only; nothing is gated on it.
- 34d3ec2: feat(framework): extract a shared single-select gate primitive (`requestChoices`) (#335)

  The single-select choice gate (#304) is now a reusable `requestChoices({ id, title, options, recommended })` export, the twin of `requestMultiSelect` (#332): it emits the `choice` event, parks for the pick, and falls back to the recommended option if the run is headless or aborts. It is the primitive the system prompt's `showChoices()` and the research preset need. No behavior change for existing runs.

- c762529: Assemble a run's system prompt in one place. The build path (`runFramework`) and the direct-prompt path (`runPrompt`) each inlined the same composition (the #326 prompt block, then the always-on emit protocols), and the two drifted apart, which is what dropped the #326 action layer from `--vanilla` builds (#500). Both now go through a single exported `composeRunSystem()` in `system-prompt.ts`, with unit tests pinning the order and the unconditional emit protocols so the two paths can never diverge again.
- c72d155: Give the dashboard clear feedback when a run is started. A run is spawned detached, so there was a gap between clicking Start and the first event (and a failed launch produced nothing, so the page looked frozen). Now clicking Start shows an immediate "Starting your run..." banner; if no output arrives within ~8s it warns that the run may have failed to start; a run-launch/exit failure surfaces as an error banner; and a rejected Start (a run is already active) shows a clear "busy" banner instead of a tiny note.
- c6d005f: Add the "Suggest new tickets" preset (#462), the Agentic PM ideation prompt. Like the other presets it prefills the dashboard editor and runs as a `prompt` kind. Per #674 the prompt is a single line, "Suggest new tickets": the run-start context fragment (#683) already points the agent at the existing `tickets/**.md` and the `.the-framework/ticketing-format.md` spec (#684), so it does not need to re-teach the ticket format or spell out the flow. Per the settled #624 model the proposal is just a PR: merging accepts the tickets, closing rejects them.
- 2fc612a: Sync the built-in system prompt with the #326 doc (#555). The shipped prompt was the 11-Jul draft: the doc was rewritten on 13-Jul and never synced, so every run since has been driven by a stale prompt. `prompts/system_prompt.md` is now byte-identical to the doc again.

  What the agent gets that it did not before: `## Analyze the user prompt`, which analyzes the prompt up front and records the results in an `ANLYSIS_RESULT.md`; `## Before starting changes` -> `### Session name`, which commits any dirty tree, then creates and checks out a `the-framework/<session>` branch before the first change and calls setSessionName(); and `## After applying changes`, which calls setReadyForMerge() once the session has no work left. `## Unclear scope` is now `### Ambiguous prompt`, `## Large scope` is now `### Scope`, and `## Alternatives` moves under `## Before applying changes`. The branch step is the notable one: it previously reached the agent only as an aside in the signal protocol, so the doc's own instruction never shipped.

  `showMarkdownSecondary()` is emitted as the same `show-markdown` block as `showMarkdown()`, per the doc: for the MVP the two are equivalent.

  Also fixes the eco flags, which the sync would otherwise have broken silently (#314). They drop sections from the prompt by exact heading string, and the rewrite renames or moves every heading they matched; a missing heading is a no-op, so `--eco-auto-planning` and `--eco-auto-research` would have quietly stopped trimming anything, with no test failure to catch it. They are retargeted at `### Scope` and `### Alternatives`, the drop is now level-aware so removing a `###` stops at its sibling instead of swallowing the next `##`, and the tests assert a flag actually shortens the prompt rather than asserting a heading is absent (which passes for free once that heading is gone).

  `--eco-auto-maintenance` now drops nothing and is inert: the maintenance section left the system prompt for the post-merge prompt, so those tokens are already saved for every run. The flag stays parsed and persisted, and re-points at the post-merge prompt when that lands (#556).

- 5c83bc2: The built-in system prompt is now Rom's #326 text, verbatim, replacing the anti-lazy-pill it grew out of: unclear scope becomes a ranked `showChoices()` list, a large scope a `PLAN_<session>.agent.md` to approve, a very large one also a `TODO_<session>.agent.md` backlog, an alternatives pass rates problem "variability" before code is written, and edits to existing code stay minimal. The prompt is a template (#350): `${{ ... }}` JS fragments render against the run context, so `tf.params.autopilot` relaxes the maintenance stance on autopilot runs and `${{tf.prompt}}` carries the user prompt slot. New exports: `SYSTEM_PROMPT_TEMPLATE`, `renderSystemPrompt`, `renderTemplate`; the `ANTI_LAZY_PILL` export is gone (the `antiLazyPill` config key still toggles the built-in prompt). `--autopilot` now has an effect without a preset.
- 9345476: Record every finished run in the project log `.the-framework/LOGS.md` (#379). When a run ends, the CLI appends an entry with the intent/prompt title, the kind (build or prompt), the final status (done/stopped/failed), and the Claude Code session id and link. Best-effort, so a log write can never break a run. This is what makes the project DB (#378) fill itself; the run-history sidebar in #314 reads from it.
- 59e3707: New `.the-framework/LOGS.md` project-log module (#378): `appendLog`/`readLogs` keep a human-readable markdown log of every loop, prompt, and build in a project, with `renderLogEntry`/`parseLogs` as the pure core over the same StoreFs seam as the run store. Parsing is forgiving: a malformed entry is skipped, never thrown. Standalone for now; the run-lifecycle wiring and dashboard UI land in follow-up issues.
- 6b561fc: Add project repo helpers (#380): `isActivated()` checks the `.the-framework/` activation marker via an injectable `ProjectFs`, and `crawlRepoFiles()` lists every tracked + untracked (gitignore-honoring) file via `git ls-files -z` behind an injectable `GitRunner`. Both forgiving: any failure reads as not-activated / an empty list. Building blocks for the #314 sidebars.
- 883d974: Add the ticket-format spec (#684): `ticketing_format.md` describes the `tickets/<DATE>_<SLUG>.md` and `.spike.md` file shapes (including the optional `priority:` and `topics:` fields). Per #674 it ships inside the package and the run-start context fragment references it by its `node_modules` path, so the format versions with the package rather than being materialized into each repo.
- 83e6a1f: Keep the flat backlog under a root `tickets/` directory (`tickets/TODO.md`) instead of the repo root, so The Framework rides on a plain, visible convention (beside `DECISIONS.md`) rather than a proprietary file (#629). New backlogs are created there, the dashboard surfaces it, and a legacy root `TODO.md` is still read so existing repos keep their backlog. Session-scoped `TODO_<slug>.agent.md` files are unchanged.
- 5dcd8a4: Replace the dashboard's Start-a-run textarea with a rich prompt editor (Tiptap). Type `/` for commands (load a preset, or insert an agent action like `showMultiSelect()`) and `@` for references (the repeated macro tags `<AWAIT>` / `<REVIEW_FILE>` / `<TODO_FILE>` / `<SESSION_NAME>`, and the registered projects — a project mention also adds its repo to the run context). Tokens render as chips but serialize back to the exact plain text the agent already reads, so the run contract is unchanged. Markdown is live (StarterKit shortcuts) and round-trips faithfully, so a loaded preset comes back essentially verbatim with its tags chip-ified.
- 3bd0478: Move the flat backlog from `tickets/TODO.md` to a root `TODO-AGENTS.md` (#682), so `tickets/` holds only tickets. New backlogs are created at `TODO-AGENTS.md`; the loop, the resume-note appender, and the dashboard doc sidebar all read it, and existing `tickets/TODO.md` (and a pre-#629 root `TODO.md`) are still read as fallbacks so no repo loses its backlog. Exposes `LEGACY_TICKETS_TODO_FILE` alongside the existing `LEGACY_TODO_FILE`.
- d1202dc: The backlog loop (#323): after the build settles, the run consumes the agent's own TODO backlog (`TODO_<slug>.agent.md`, or the flat `TODO.md`) one entry per turn until it is empty. When a dashboard can answer, the loop gates before each entry ("start the next item?"), so autopilot consumes the backlog unattended and autopilot-off pauses per item. Caps make it safe overnight: the budget/Stop signal ends any turn, `--max-todo-items` bounds the run (default 25), and two no-progress items stop the loop. `--no-todo-loop` opts out.
- e453bba: Transparent mode (#625): a coarse master off-switch that makes a run identical to plain `claude -p <prompt>` — the "only pick what you need" requirement, at its extreme. Turn it on and the wrapped agent runs fully raw: no framework system prompt, no AWAIT/SIGNAL emit protocols, no consumption guard, no dashboard, no TODO loop.

  Available at all three tiers: the `--transparent` flag, a `the-framework.yml` `transparent: true` key (per project), and a `transparent` user preference surfaced as the "Transparent" toggle in the dashboard's run options (it overrides the other option toggles, and the "Actual prompt" preview correctly shows an empty channel).

  This also closes the gap where `--vanilla` was advertised as "fully transparent" but still injected the AWAIT/SIGNAL protocols into the system channel: `--vanilla` keeps that emit contract (so the agent can still drive the dashboard's gates), and `--transparent` is the new switch that drops everything for a genuinely raw run. `composeRunSystem` now returns an empty string under transparent, the single place the whole system channel is assembled.

- e4b518a: feat(framework): turn an agent's showChoices()+AWAIT into a live gate at the turn boundary (#337)

  The system prompt tells the agent to `showChoices()` and `AWAIT` at unclear-scope / alternatives points, but until now only framework-emitted gates (multi-select) could pause a run. Now when a build turn ends by asking the user, an `await-choices` block, the framework shows the choice on the dashboard, waits for the pick, and re-prompts the agent to continue from that decision. It is a no-op when headless and when the agent just finishes instead of asking, so existing runs are unchanged.

- bc3586b: Keep everything in a single `.the-framework/` directory (#313). The transient run state (`events.jsonl`, `run.json`, `runs/`, `control.jsonl`, `daemon.json`) now lives in `.the-framework/` alongside the committed project log `LOGS.md`, instead of a separate `.framework/` directory. `install` seeds a `.the-framework/.gitignore` that ignores everything except `LOGS.md`, so the run state stays transient and only the log is committed.
- 7db5a9c: feat(framework): track agent spend and add a budget cap (#322)

  The framework now accumulates the token + cost usage the wrapped agent reports each turn, streams a running total as a `usage` event, and shows a live spend readout on the dashboard header. Pass `--max-cost <usd>` to stop a run once it has spent that much: the current turn finishes, then the run stops cleanly (not a failure). Useful for long autopilot runs where you only review the result at the end.

- 3302b0f: Add the usage panel: what the account has left (the agent's own quota windows) and how much of it The Framework may spend before it pauses itself (the three consumption limits, each with a checkbox and a bar). Replaces the dashboard's "Usage & credits" placeholder.
- 5417558: Add the [UX] preset (#472): a direct, interactive usability review of a target (defaults to `this PR`), shipped alongside [Research], [Readability], [Maintainability], and [Security audit]. It enumerates every finding as a categorized, reference-numbered list of choices via `showChoices()`, stops for the user to accept proposals, then works on the accepted ones. Available as a dashboard Start-a-run button and exported as `renderUxPrompt`.
- 8d396f7: Add a git-worktree lifecycle module (`addWorktree` / `listWorktrees` / `removeWorktree` / `pruneWorktrees`), the foundation for running multiple tasks concurrently on one repo (#453). Each run will get its own checkout under `.the-framework/worktrees/<runId>` so concurrent runs never fight over the working tree. This slice is the isolated, unit-tested plumbing only; the daemon wiring, per-worktree concurrency, and dashboard changes land in the sibling #453 issues, so nothing changes at runtime yet.

### Patch Changes

- e65e16a: Fix the agent-CLI runner emitting a spurious `error` event after a run is aborted. On abort the turn rejects and settles, but the killed child process still fires `close` afterward, and the close handler emitted an `error` (and would have emitted `result`) telemetry event before checking whether the turn had already settled. The dashboard event stream saw a phantom agent error after a clean Stop. The close handler now returns early once the turn has settled, so an abort produces exactly one outcome.
- 5844526: Rework the run's agent + model picker into a tree (#656, #658). The dropdown's top level is the coding agents, each showing its logo (Claude / Codex, #656); hovering an agent reveals only that agent's own models, and picking a model sets both the agent and model together — so an incompatible pair (e.g. Codex with a Claude model) can no longer be chosen. The trigger shows the current agent's logo then the model, with the agent name in the tooltip.
- 6721c0f: Untangle the two "autopilot" concepts in the dashboard (#325): the countdown text now reads "Auto accept in 10s" (and "Auto accept canceled" / "Auto accept off"), so "autopilot" is left to mean the mode preset. The checkbox that arms the countdown is labeled "Autopilot", per Rom's call on the issue.
- 8c576df: Adding a project that isn't a git repo now initializes one for you instead of failing with `fatal: not a git repository`. `installProject` detects a non-repo folder and runs `git init` before its usual commit-and-install flow, so a plain directory can be added straight from the dashboard. The install result reports `initialized: true` when it did so.
- be0a58c: Fix backlog turns dropping the agent's signals. The backlog loop prompts through the run's own driver session, so a backlog turn carries the same signal protocol as any other turn, but it only ever parsed await gates. `showMarkdown()` views never reached the dashboard rail, `setSessionName()` was ignored, and `setReadyForMerge()` never emitted `ready-for-merge`, so `--post-merge` could not fire from backlog work. The turn-signal parsing (views, session name, ready-for-merge) was duplicated verbatim in the build path and the direct prompt path and missing from the third; it is now one `createTurnSignalEmitter` used by all three, with the backlog loop sharing a single emitter so `ready-for-merge` still fires once across every item.
- 7a94b48: Fix `framework --version` (and the bare-`framework` footer) reporting `0.0.0` instead of the real package version (#312). The version is now read from the package's own `package.json` at runtime, so it always matches what is installed.
- aac6e5d: Tidy the Start-form run controls (#654): the Presets and Agent·Model dropdowns are now compact, the six Global options (Autopilot, Technical control, Disable system prompt, Eco, Post-merge cleanup, Browser) collapse into one "Options" checkbox dropdown next to Presets (with Eco's sub-drops when Eco is on), and the Agent·Model menu sits at the end of the row.
- cdfe508: Show the files picked into a run's Context (#661). Files added via a `#` mention or the right-rail file tree were counted ("Context · 1 selected") but never shown, so clearing the prompt left them selected with no way to see or remove them. They now appear inside the Context section, listed like the repo rows but with an X to remove (which also unticks the file in the tree, since they share one context set). The Context section's contents get the same bordered box as the prompt disclosure, and that disclosure is renamed to just "Actual prompt". The Context header now breaks its count down as "N projects · N files", and the right-rail Files tab badge counts only selected files (not the whole-repo entries that also live in the context set).
- d4fe2e5: Don't offer the current project as a Context focus target (#665). The Context → Projects list is for pulling _other_ repos into the agent's focus; the current project is already the run's workspace, so ticking it was redundant. It's now excluded from the list (and from the "N projects" count), with a "No other repos to add" hint when it's the only registered project.
- 5646b16: Lay out the expanded Context section as two columns (#663): a "Projects" column (repo checkboxes) beside a "Files" column (removable file rows), each under its own heading. The Files column shows a hint when nothing is picked, and the repos' "can still reach the rest" note moves to the Projects heading tooltip.
- 65e27fd: Tidy the run controls row (#668): the Global-options button becomes a gear icon with the on-count as a small corner badge (no "Options" text), the agent/model picker moves to the start of the row, and the "Start run" button sits at the end of that same row (the note/error stay below).
- e0404cf: Stop the daemon from registering its own cwd as a duplicate project. When the daemon runs from a subfolder of an already-tracked repo (e.g. the package dir the binary lives in), it created `.the-framework/` for its own state and then re-added that subfolder as a nested project on every boot. `registerHomeProject` now skips a cwd that lives inside an already-registered project.
- dcea89b: Fix `framework stop` returning before the daemon has actually exited (#514). It signalled SIGTERM and removed the state file straight away, so restarting immediately raced the old process for the port: the new daemon hit EADDRINUSE, never reported itself ("the daemon did not come up in time"), and the old one kept serving a stale bundle with no state file left to stop it by. `stopDaemon` now waits for the process to exit before returning, escalating SIGTERM to SIGKILL if a wedged shutdown outlasts the grace period.
- 900efbb: Center the dashboard's main grid in the content column. `main` had a `max-width: 1100px` cap but no horizontal centering, so on a wide window the panels hugged the left edge next to the runs sidebar. Add `margin: 0 auto` so the capped grid sits centered.
- 48aba07: Make the dashboard layout fill the viewport height. `#layout` only grew to its content height, so on a short page the runs-sidebar right border stopped partway down instead of reaching the bottom. Give `#layout` a `min-height: calc(100vh - 57px)` (matching the sidebar's existing header-height key) so the stretched sidebar runs full-height.
- ed25ab8: Keep the dashboard header and sidebar in view while scrolling. The header is now sticky at the top (with a background and z-index so content scrolls under it), and the app-running banner and the runs sidebar stick just below it. On a long page you no longer lose the title, stop button, and run list when you scroll down.
- 131f349: fix(framework): surface session-scoped PLAN/TODO docs in the dashboard sidebar (#323)

  The document sidebar now also surfaces the session-scoped `PLAN_<SESSION>.agent.md` / `TODO_<SESSION>.agent.md` files The Framework writes per run (#323/#326), not just flat `PLAN.md` / `TODO.md`. Flat files stay supported as a fallback for hand-written docs. Names are matched against the workspace root with a fixed slug pattern, so there is still no path traversal.

- f1ff0d2: Fix the Claude Code driver reporting `costUsd: 0` when a result line carries token usage but no price. `DriverUsage.costUsd` is documented as omitted (never `0`) when there is no price, because the budget cap reads `0` as "this turn was free" rather than "the price is unknown" (#540). The driver now omits the field in that case, matching the Codex driver and the type's own contract. Claude runs that do report a price are unchanged.
- 4a741f6: `runPostMerge` now materializes the quality presets before queueing, so the post-merge TODO entries' `filePath` values always resolve (#598). Previously the presets were written only on install and are gitignored, so a repo activated before that feature shipped, or a fresh clone, had no preset files and the queued entry pointed at a path that did not exist. Best-effort: a materialize failure is reported, never fatal.
- c05a186: Harden the dashboard against cross-site abuse and event-borne XSS. The state-changing dashboard routes (`/stop`, `/choice`, `/api/start`) now reject any request whose `Origin` is a foreign site, so a page on another origin can no longer drive the localhost dashboard into spawning or steering a run (a non-browser caller that sends no `Origin` is unaffected). The client render pipeline no longer trusts event strings: link URLs (session link, preview URL, run-history link) are scheme-checked so a `javascript:` URL collapses to `#`, and the HTML escaper now escapes quotes so a relay-published event can't break out of an attribute (e.g. a choice option id like `x" autofocus onfocus=...`).
- ee075ec: Fix the #326 action-layer protocols being dropped from a build run's system prompt when the built-in prompt is off. `runFramework` nested the `AWAIT_PROTOCOL` and `SIGNAL_PROTOCOL` blocks inside the built-in-prompt branch, so a `--vanilla` build (or `antiLazyPill: false` via `the-framework.yml`) with no `SYSTEM.md` injected neither — leaving the agent with no way to emit `set-session-name` / `ready-for-merge`, so `setReadyForMerge()` and the `--post-merge` quality suite silently never fired. The protocols are now appended unconditionally, matching the direct-prompt path (`runPrompt`).
- 06fefbe: Apply Rom's #559 review to the business-knowledge docs (#537): drop `README.md` (a repo's own `README.md` already covers the overview), move `DECISIONS.md` and `KNOWLEDGE-BASE.md` to the repo root, and show each doc's one-line gloss in the injected `Context:` too, not just the post-merge prompt. The `## Business knowledge` prompt text is now his verbatim wording.
- c584b16: Fix "last activity" so it reflects runs, not just `LOGS.md`. A project's `lastActivityAt` is now the newest of its latest `LOGS.md` entry and its most recent run (live or archived), so a project with runs no longer reads "no activity yet" just because a run stopped before writing to `LOGS.md`.
- 79af200: Report a failed relay publish instead of dropping it. `relayPublisher` never checked the HTTP response, so only a thrown fetch reached `onError` and every error status was silent: `--share <url>` printed a shareable link and then reported nothing, forever.
- c06532e: Consolidate the dashboard header's three notification icons (browser bell, Discord, activity pulse) into one labeled "Notifications" bell that opens a popover (#676). The popover groups the toggles the way the model actually works: a "Deliver to" section (Browser, Discord) for where notifications go, and a "Notify me about" section where "Needs you" is shown as always-on and "New activity" is an opt-in toggle. The bell shows an active state and dot when a delivery method is on. Purely the header control; the underlying preferences and notification hooks are unchanged.
- 43bae91: The on-before-mergeable follow-up no longer strands its output on a branch nothing merges. It was spawned as a plain `framework prompt` run, so it inherited the #326 system prompt's `### Session name` step and committed + created + checked out a fresh `the-framework/<name>` branch before writing anything. Its output (the queued quality TODO entries and the business-knowledge docs, `DECISIONS.md` / `KNOWLEDGE-BASE.md`) landed on that branch, which nothing merges, so the next run branched from main and could not see it. The follow-up is a follow-up to a session, not a session of its own, so it now runs `--vanilla` (no built-in prompt, hence no session-name step) and stays on the session's current branch, where its output rides to review and merge with the work.
- f50f0d5: Fix the dashboard's event tail dropping a same-length rewrite. There were two JSONL tailers: `JsonlTailer` detects an in-place truncate both by the file shrinking and by it being rewritten to the same length (mtime advanced), while `tailEvents`, which is what the dashboard Channel runs, only checked for a shrink and never read mtime. A fresh run that rewrote `events.jsonl` to the same byte length was invisible to the dashboard. The two tailers, and the two hand-rolled `fs.watch`-plus-poll drivers behind them, are now one `JsonlTailer` + one `followFile`, so the run's control tail and the dashboard's event tail share the tested behavior instead of drifting. `tailEvents` had no test of its own; it has three now.
- d1331a2: Collapse the Start-form preset controls into one "Presets" dropdown (shadcn base / Base UI). The built-in presets, the user's saved presets (each removable), and "New preset…" now live in a single menu instead of a row of buttons, keeping the prompt area compact as presets grow.
- 1f1a2a3: Reconcile orphaned runs on daemon start. A run a dead process left marked `running` (a crash, kill, or daemon restart) no longer shows as active forever with a no-op Stop: a freshly started daemon drives no in-flight run, so at boot any such run across registered projects is flipped to `stopped` (the live one archived first, keeping its history).
- 1e1b4dc: Store the multi-project registry as a single file, `.bashrc`-style: `$HOME/.the-framework.json` (or `$XDG_CONFIG_HOME/the-framework.json`) instead of a `projects.json` nested inside a `.the-framework/` directory (#390).
- 28c3330: Fix the relay's publish-body reader corrupting multibyte payloads and mis-applying its size cap. It decoded each TCP chunk independently (`body += chunk`), so a multibyte UTF-8 codepoint split across a chunk boundary decoded to replacement characters; and it compared the running string's `.length` (UTF-16 code units) against `maxBodyBytes`, so the cap was wrong for any non-ASCII body. It now accumulates raw `Buffer`s, caps on the byte count, and decodes once at the end.
- 734da1a: fix(framework): harden the run relay and workspace sandbox against resource exhaustion

  - The relay now caps how many runs it holds in memory and evicts the least-recently-used one on overflow. Because it is unauthenticated, an anonymous request to `/r/<id>/…` could previously create per-run state that was never freed; run creation is now bounded (`maxRuns`, default 200).
  - A disconnected SSE viewer now cancels its stream iterator, releasing its waiter immediately instead of lingering on the stream until the next event (which may never arrive for an idle run).
  - `snapshotWorkspace` checks a file's size before reading it, so a large asset in the workspace is skipped without ever being loaded into memory during a `--sandbox docker` sync.
  - `relayPublisher`'s POST has a timeout, so a relay that accepts a connection but never responds can no longer hang the CLI on exit (`flush()`).

- 2a12ec8: Remove the "Vike · React · shadcn · Telefunc" tech-stack line from the dashboard header.
- 4a70c5a: Fix `savePreferences` rejecting the RPC when the underlying write fails. The telefunction advertises a `{ ok: false, error }` result and already returns it for the not-enabled case, but a failed disk write threw straight through, so the client saw a rejected call instead of the typed error. The write is now wrapped, so both failure modes return `{ ok: false }` and the client handles them the same way.
- a76ace7: Seed a run's intent (its prompt) when the run store opens, so the dashboard's Runs list labels `prompt` and `research` runs with their prompt instead of "(no prompt)". Only build runs emitted a `bootstrap` scope event carrying the intent; a direct-prompt or research run had none, so its row showed no label. A build run still refines the seeded intent via its scope event; research with no "what" seeds the same "this PR" default the log title uses.
- 437618f: Fix transparent mode so it is actually raw Claude Code (#678). Transparent (#625) is meant to run identical to `claude -p <your prompt>`, but a build-kind run (a plain typed prompt, the dashboard default) still went through the full `runFramework` orchestration (scope, plan, dispatch, synthesize, production-grade pass) and sent the wrapped `extendPrompt`/`buildPrompt` text to the agent instead of the raw prompt, because run-path routing keyed only off the `research`/`prompt` subcommands. Transparent now routes any run through the raw prompt path, so the prompt runs verbatim with no build orchestration and no wrapping. Research rendering still applies only to a genuine (non-transparent) research run.
- caf8a0b: Give the run-form disclosures one consistent style (#659). "See actual prompt sent" and "Context" were styled differently (different triangle glyph, weight, and indent); both now use a shared `DisclosureToggle` — a chevron that rotates when open, then the label — so they read as the same control.
- Updated dependencies [734da1a]
- Updated dependencies [df15f71]
- Updated dependencies [9442761]
- Updated dependencies [5e24797]
  - @gemstack/ai-autopilot@0.10.0

## 0.8.0

### Minor Changes

- 385c953: feat(framework): hosted run relay — watch one run from multiple browsers (#230)

  The first slice toward shared team sessions: a run can now be watched live from more than one machine. `framework relay` hosts a relay; a run started with `framework "..." --share <relay-url>` publishes its event stream to it and prints a shareable URL. Anyone who opens that URL gets the same dashboard over SSE, replaying the run's full history and then following live — so two teammates watch one build together.

  Reuses the existing dashboard: the SSE serving is factored into a shared helper and the page's stream/stop paths are now relative so they resolve both on the localhost dashboard and under the relay's `/r/<id>/`. New exports: `startRelay`, `relayPublisher`. Deliberately unauthenticated — accounts, teams, RBAC, and authorized steering layer on later; the relay only projects the stream, it never runs an agent.

## 0.7.0

### Minor Changes

- cc6a8db: feat(framework): AI meta-select — auto-pick the Open Loop domain preset, modes, and build event kind from the prompt + workspace (#270)

  A live run with no `--preset` (and none in `the-framework.yml`) now infers the best-fit domain preset, its modes (technical / autopilot), and the build event kind from what you asked for and the project you are in, then runs under it. So `framework "add a login page"` in a web app picks Web Development on its own. `--no-auto-preset` opts out (plain framework flow); `--fake` stays deterministic. Any failed or empty pick falls back to the plain flow, so the auto-pick never blocks a run.

- 5f319ff: feat(framework): show the active Open Loop modes as read-only checkboxes on the dashboard (#272)

  When a run builds under a domain preset, the dashboard now renders a Modes panel with the run's modes as checkboxes ([x] technical / [ ] autopilot), so the policy driving the build is visible beside the stack and loop panels. Backed by a new `modes` framework event (`OPEN_LOOP_MODES` is the canonical mode ordering, shared with the meta-select router); a run with no preset emits nothing and shows no panel. The event persists with the run, so `--resume` rehydrates the panel too.

- 9f62be7: feat(framework): run the `--serve` verification in a Docker sandbox (#229)

  `framework --serve ... --sandbox docker` now boots the app inside a throwaway container instead of on the host: the source is copied in, deps install and the dev server runs in the container, and the health check hits a mapped port. So agent-authored code never installs or runs on your machine to be verified. `--sandbox local` (the default) is unchanged — it adopts the host cwd in place.

  This is the first slice of #229: only the serve verification is sandboxed; the build itself still runs on the host (the container is re-seeded with the latest source before each check). Requires a reachable Docker daemon — a run that asks for the sandbox without one fails fast with a clear message; `--sandbox docker` without `--serve` is a no-op note. `runFramework` gains `sandbox` and an injectable `runner` option.

### Patch Changes

- Updated dependencies [08f5710]
  - @gemstack/ai-autopilot@0.9.0

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
