# @gemstack/the-framework

## 1.4.0

### Minor Changes

- 79d1689: Re-skin the dashboard onto the landing page's Everforest identity (IBM Plex Sans, warm dark palette, squarer corners) and rename the two queues to "Human Queue" and "AI Queue" so the dashboard and the-framework.ai read as one product.
- 23385a1: Dashboard: remove the top navbar and move its chrome into the sidebar (brand, a prominent Overview, an expandable Projects nav, and the Local/theme/notifications/Settings controls in a footer). Add a `project / session` breadcrumb and an always-available session-details disclosure (agent + spend) to the session toolbar, and fold the toolbar's actions (GitHub, folder, editor, Serve, Stop, Remove worktree, Delete, Open session) into a single overflow menu. Polish the Recents rail: themed scrollbar, a sticky label with a scroll-driven fade, lighter weights, and a hover marquee for long titles. Stop the toolbar flickering on session navigation (keep-previous on the git status / GitHub reads). Add an opt-in `pnpm dev:daemon` so the dev server can start runs by proxying to the daemon.
- ef0d941: Add a "Hot tickets" overview to the dashboard.

  The Overview now has a cross-project glance at the tickets that matter right now, in three lanes: In progress (tickets the agent has planned or spiked), Up next (high priority, not started yet), and Queued (the rest of the open backlog). Each row names its project and jumps into it when selected.

  It pools every project's `tickets/`, so it is a projection of the same files the agent plans from, polled so it stays live. Empty lanes collapse to a single header line, so an import-heavy repo where everything sits queued still reads as designed.

- 2c1e6d4: Start a run with no project, in a neutral scratch directory.

  A "topic" run starts project-less: it spawns in a neutral scratch dir under the config home with no repo or worktree, so the agent has no code to touch. This is the "ask a question, plan, or draft a ticket without a repo" path. It still produces the normal run lifecycle (events.jsonl, run.json, settle) inside the scratch dir.

  A new `sendStartTopic` RPC starts one beside the project-scoped `sendStart`, keeping the home-default behavior untouched. The scratch dir is retained on failure or stop and removed on a clean finish, mirroring the worktree retention rule. The UI for it is tracked separately.

- f674fbc: Add a repos-directory preference with an opt-in auto-grant (#1123): a root directory the project-registration flow will default into, plus an off-by-default toggle that auto-adds every git repo directly inside it on daemon boot.
- 2581fce: One shared sidebar on every route, rebuilt on the shadcn Base UI sidebar.

  The sessions rail used to vanish the moment no project was selected, so the home/Overview had no left column while a session page did. It is now the shadcn Base UI sidebar, rendered on every route, so the two read as the same app.

  On the Overview it pools recent sessions across every project (a new cross-project read), each row naming its project and jumping into it when selected; a selected project still shows its own runs.

  "New" is now project-aware: with no project it opens the add-project dialog (there is nowhere to run a session yet), with one project it starts there, and with several it opens a picker so you choose where. In a project already, it starts another session there.

- 7509a4c: feat(the-framework): let a project-less topic run bind to a project via an await gate, with the registered projects injected into its context as the list to pick from (#1121)
- 8ddbade: feat(the-framework): re-home a bound topic run into its project (#1122): the daemon watches for the recorded bind, allocates a worktree in the chosen project, resumes the same agent session there via continue-run, and tears down the scratch, so a bound topic run becomes an ordinary run living in the project's worktree

### Patch Changes

- f09a5d8: Fix the navbar overflowing the page at narrow widths.

  Below a narrow viewport the top nav pushed the whole document wider than the screen, so the page scrolled sideways and slid the app off-screen. The cause was the nav's fixed clusters: the brand mark plus wordmark on one side and the "New session" button plus the icon buttons on the other were both `shrink-0`, so together with the project picker they could not fit a phone-width viewport.

  Below `sm` the nav now folds down to what fits: the brand keeps its mark (still the link home) but drops the "The Framework" wordmark, the "New session" button collapses to its `+` icon (still labelled for a screen reader), and the project picker caps narrower and truncates a long name. At `sm` and up everything is exactly as before. Verified by driving a real browser at 375px and 420px (no page scroll) and at 1200px (labels back); jsdom cannot see this class of layout bug.

- e1765be: Dashboard: the session's status (stopped, ready for merge, failed) is a small label beside the ⋮ menu in the session toolbar instead of a banner over the feed, and the one session that cannot be continued says so in the composer's placeholder rather than in a note above it.
- 0e37ffd: Add a "Suggest new features" preset.

  The Agentic-PM presets covered proposing work items you describe (Suggest new tickets), researching the outside market (Market research), and choosing among tickets that already exist (Suggest tickets to work on) — but not proposing net-new features from the product itself. This fills that corner: it studies what the product does today and proposes features it should have next, writing each as a ticket under `tickets/` for the normal triage pipeline to pick up.

  Autonomous rather than gated, like the other suggest-class presets: a proposal is a reviewable ticket, so the human triages later instead of approving mid-run, which also keeps it usable on a schedule. Paramless — it scopes itself to the whole product, so there is no blank to fill.

## 1.3.0

### Minor Changes

- a6983a7: Reclaim a session's worktree once its work has landed.

  A run that failed or was stopped keeps its checkout so you can read what it was holding, and nothing ever took those back, so a machine accumulated one full checkout per such session forever. The daemon now sweeps the registered projects every ten minutes and removes the checkouts whose branch has landed.

  Only the checkout goes. The branch, its commits, and the session's row and replayable log are kept, so everything this reclaims is a `git worktree add` away. That is what makes it safe to do without asking.

  A branch counts as landed on either of two signals, because neither alone is enough. `git branch --merged` is the stronger one, since it proves the commits are reachable from the local base, but it only holds for a merge that kept them: a squash or rebase merge rewrites the commits, so the branch never becomes an ancestor and the signal never fires. A merged PR closes that gap. A closed-unmerged PR does not count as landed, since the checkout of rejected work is the one you are most likely to still want.

  The sweep is conservative wherever the answer is unclear: a live run keeps its checkout, and so does a branch that no longer exists or one whose state cannot be read.

  `framework worktrees sweep` runs the same pass on demand, next to the existing `prune` (which removes every checkout whose session is no longer running, landed or not).

- a82411e: Print the commands and the version on bare `framework` too (#312).

  #312 describes what `$ framework` should do, and two of its items were already built: the convenience command list and the version footer with the npm "up to date" check. Both lived only in `ensureDaemonCmd`, the `framework --daemon` path. Bare `framework`, the command the issue is actually about, foregrounds the dashboard instead and printed two lines: the URL and "Ctrl+C to stop".

  Both paths now print one shared footer, so the version you are running is visible from the command people actually type, and so is a newer release when there is one.

  The update line is not awaited before the static lines. #312 asks for the static info first, and the foreground path blocks on the server until it is signalled, so anything held back until after the registry call would never have been printed there at all. The check keeps its existing 2.5s cap and stays silent when npm is unreachable.

  The foreground footer drops the `framework stop` line, which stops a detached dashboard; that path tells you Ctrl+C instead.

- aa349a4: Manage saved devices from the settings page.

  Adding and removing a device already worked, but only from the composer's "Run on" menu, and the composer only exists on a project launcher. From the Overview or the settings page there was no way to manage the roster at all. The settings page now has a **Devices** section listing each saved device with its origin and online/offline status, an Add device button, and a remove per row. The "Run on" picker still lists devices, because choosing a run target is a per-run act; which devices exist is configuration.

  Removing a device from settings clears the run target when that device was the one selected, the same guard the composer already applied, so a run can never point at a device that is no longer saved.

  The section states that devices are saved in the browser rather than on the server: unlike every other setting on the page, a device carries a token, so it stays in this browser's storage and never reaches the daemon.

- afa43b1: Configure the Discord bot and webhook from the dashboard (#1095).

  Both Discord credentials were daemon environment variables and nothing else, so enabling Discord meant editing the daemon's environment and restarting it. That made it the one onboarding step you could not finish in the product: the #958 checklist could tell you the daemon had no token, and then only tell you to go elsewhere.

  The setup dialogs now take the credential. It is stored in the registry file at the same tier as the daemon token (#1051): top level, never in `preferences`, so it cannot reach the browser bundle or a per-project override. The file is written owner-only. The daemon rebuilds its Discord services on the save, so the bot connects and the notification watchers start without a restart.

  The value only ever moves inward. There is no read that returns a credential: the dashboard is told which ones exist and where each came from, which is the presence-only contract `onNotifyChannels` has had since #948. A stored credential shows as saved, with Replace and Remove rather than a field holding a secret.

  An environment variable still wins over a stored value, and the dialog says so instead of offering an edit the daemon would shadow. That is how a container, a systemd unit or a shared box keeps configuring the daemon it runs.

  The bell, the settings rows and the checklist now read this from one shared value rather than three independent polls, so saving a credential in one place settles all of them at once.

- e0517cf: The end-of-session handoff happens by itself: Push branch and Open PR are now checkboxes, ticked by default.

  They used to be two buttons on a finished session, and the code was explicit that they should stay clicks, on the grounds that publishing the agent's work under your name is your call. In practice that meant a click per session for the thing you almost always want, and when nobody clicked, the work stayed on a local branch nobody was told about.

  The call is still yours, it is just made once instead of every time. The two controls are now **pre-commitments** in the session action bar: whatever is still ticked when the session settles happens on its own. Leave them alone and it is zero-config. Untick either one while the session runs to opt out, and the old button comes back, so the deliberate path is never lost. A failure falls back to the button too, with git's or `gh`'s own reason beside it.

  The pair is not independent, because `gh` will not open a PR for a branch the remote has never seen: ticking **Open PR** arms the push, and unticking **Push branch** unticks the PR.

  The PR is opened as a **draft**, so firing on every session does not put a review request in anyone's inbox. That needed one change elsewhere: the interventions queue skipped every draft, on the grounds that a draft is not asking for review. For a PR the framework opened for itself that reasoning inverts, since then nothing would tell you the work exists at all. The queue now lists a draft on a `the-framework/*` branch and still skips drafts opened by hand.

  New per-project preferences `autoPushBranch` and `autoOpenPr` set where the boxes start; both default on. The CLI has `--no-auto-push-branch` and `--no-auto-open-pr`, which travel as explicit `--no-*` flags for the same reason the repo-config toggles do: these default on, so silence would re-arm them.

  The handoff runs after the on-before-mergeable quality pass, so anything that pass committed is included, and it commits the session's own pending work first, which teardown would otherwise only do after the run process had exited. It declines rather than acting on a stopped run, a branch that is gone, a session that committed nothing, a repo with no remote, and a branch that already has a PR.

### Patch Changes

- f1cab24: Fix two faults in opening a session's pull request, both found by driving the handoff against a real GitHub remote rather than a stubbed one.

  **The PR base was a tracking ref, so opening a PR failed outright.** `RunHandoff.base` holds what `detectBase` reads out of `refs/remotes/origin/HEAD`, which is `origin/main`. That is correct for the two things the field is otherwise used for, since the commit range and the merged check are both asking git about a remote-tracking ref. It is not a thing you can open a PR against: `gh pr create --base origin/main` is rejected with `Base ref must be a branch`. The name is now converted at the `gh` boundary, leaving the field as the git ref it is. This affected the manual **Open PR** button too, on any repo whose default branch is discovered through `origin/HEAD`.

  **The "this branch already has a PR" guard could be defeated by a cold cache.** The check read through the dashboard's cached PR lookup, which answers `prPending` rather than yes-or-no while it refreshes. "Not known yet" therefore read as "no PR", and a second handoff for the same branch went ahead and tried to open another one; only `gh` refusing the duplicate stopped it. The handoff now takes the uncached lookup and waits for a real answer. It runs once, at the end of a session, so it can afford to.

- 2f8908c: Make the settings page obey the same run-option rules as the launcher (#958).

  The settings page rendered the run options as flat, independently checkable boxes, while the launcher has real rules between them. So the page could show an option checked that the launcher shows off, and allowed combinations that mean nothing: Eco under Vanilla (nothing left to trim), Browser on Codex (inert, the browser rides Claude Code's MCP config), Auto maintenance without Post-merge cleanup, and anything under Transparent, which overrides the lot.

  The table and its rules moved out of the composer into one module both surfaces render, so a rule cannot hold in one place and not the other. A row the rules disable is greyed and shows why, rather than disappearing, since the settings page is where you go to look for a setting. `checked` is now the effective value everywhere, so no surface claims an option is on while the run ignores it.

  Two smaller cases of the same thing: the notification rows now show the delivery capability the bell already showed (browser permission blocked, `DISCORD_WEBHOOK` / `DISCORD_BOT_TOKEN` unset), and the spend offset is bounded to the same range as its slider and the sanitizer, instead of accepting a value that was silently clamped on save.

## 1.2.0

### Minor Changes

- b2d23ed: Rename the package from `@gemstack/framework` to `@gemstack/the-framework`, and the CLI command from `framework` to `the-framework` (#1071), for consistency with the product name **The Framework**.

  Shipped as a new package name rather than a break in the old one: `@gemstack/framework` keeps resolving and is deprecated with a pointer here, so nothing installed today stops working. Update installs to `@gemstack/the-framework` and invocations to `the-framework`.

- 61451a1: Dashboard: the session page says its branch once. The handoff card that repeated the branch name under the action bar is gone; its verdict ("2 commits · 0 files", "no changes", "branch gone") and its Push branch / Open PR buttons now ride in the branch row itself, and clicking that row expands the commits and changed files. A live session's Changes panel folds into the same row: the file count sits beside the branch, the rows open underneath.
- ecf2ce4: feat(framework): context fragment lists the recorded conversations (#683)

  Adds `.the-framework/conversations/**.md` to `CONTEXT_DOCS`, so a run is told to read the human conversations (Discord/chat turns) that earlier runs committed there. A read-only pointer, like `tickets/` and `TODO_AGENTS.md`, so it stays out of the merge-update set. The path is pinned by a test to the canonical `THE_FRAMEWORK_DIR`/`CONVERSATIONS_DIR` constants so it cannot drift from where runs actually commit.

- 053db85: feat(framework): context fragment points the knowledge base at a `knowledge-base/` folder (#683)

  Splits the flat `KNOWLEDGE-BASE.md` into `knowledge-base/FACTS.md` and `knowledge-base/INSIGHTS.md`, and moves `DECISIONS.md` and `MARKET_RESEARCH.md` under `knowledge-base/`, with a `knowledge-base/**.md` catch-all. The on-before-mergeable prompt and the Market research preset name the same paths.

- 7c70533: Dashboard: the session log reads like a conversation. Your prompt is its own `YOU` row and the agent's turn is `AGENT`, so a message is no longer echoed twice — the redundant `You: …` log line is gone and the first prompt and every follow-up now read the same way.

  Both your prompts and the agent's replies render as Markdown (headings, bold, lists, code, links), at the log's own density. A short message renders inline; a long one collapses to its first line with a chevron and expands in place on click, so the log stays scannable without hiding the text.

  Also: the sessions rail's home row is now "New session" (a launcher) instead of "Live", and a session's id is always offered for copy in the toolbar (the exact string `--resume` takes), beside the existing copy-branch action.

- a1552ac: feat(framework): remote-daemon lane, non-loopback bind guarded by a shared token (#1051)

  `framework --daemon --host <addr>` binds the dashboard daemon to a non-loopback address so a device you own can reach it. Because a daemon that spawns processes is code execution for anyone who finds the port, a non-loopback bind generates and persists a shared token (`crypto.randomBytes(32)`, a top-level `Registry.daemonToken`, never a preference and never shipped to the browser bundle), and one guard fronts every route (static bundle, `/_telefunc`, `/browser`): a request needs a valid `fw_daemon` cookie or a matching `?token=`, else 401, compared with `crypto.timingSafeEqual`. A valid `?token=` sets an `HttpOnly; SameSite=Strict` cookie and 302s to the clean path, so one cookie rides the RPC, the live-events Channel, and the MJPEG screencast alike. A loopback bind generates nothing and the guard is a no-op, so the local zero-config path is byte-identical. The CLI prints a loud warning and the token URL on any non-loopback bind. Composes with (does not replace) the existing CSRF origin check.

- 3166507: Devices: online/offline status and remove-device in the "Run on" gear (#1072).

  Each saved-device row in the gear gains a remove (X) control that drops the device; if the removed device was the selected run target, the selection clears back to a driver target. The gear device rows and the connection indicator now show a green (online) / grey (offline) reachability dot, and an offline row is muted and labelled. The device tokens stay browser-side (per #1052), so the browser hands the local daemon each device's {url, token} and the daemon does a cookie'd `GET /_relay/ping` to report reachable or not; a short client poll drives the dots. The new ping endpoint is cookie-guarded (401 without) and starts nothing.

- 969b9bb: Dashboard launcher and rail UX pass:

  - The prompt editor and its run controls are grouped into one rounded "composer box"; the editor loses its own border and focus ring, and the placeholder and typed text get roomier padding.
  - The submit button is a single arrow icon that stays hidden until the prompt has text, then fades in and slides into place, pushing the model select over smoothly (a spinner shows while starting or sending).
  - The agent/model select sits just left of the submit button, borderless, with the model shown as selected (the default reads "Default", no separator dot).
  - Presets is a borderless slash icon, the options gear is borderless with a smaller count badge, and all controls share one height.
  - "Open in editor" moved out of the options gear onto the workspace editor button, which now opens the checkout and picks the preferred editor.
  - The right rail holds one fixed width for every tab (no expand on Views/Browser).
  - The sessions rail: "New session" is now "New", the "Sessions" heading is replaced by a "Recents" label over the list, the agent logo is smaller, and rows clear the scrollbar.
  - The session toolbar drops the copy-branch and copy-session-id buttons, and the branch dirty/clean indicator sits closer to the branch name.

- f20add1: Dashboard: the session view holds still. A run ending used to swap the whole page for a different one — the action bar blanked, the output was replaced by "Loading session…", the run overview disappeared and the composer was rebuilt. Live and finished are now the same view, so only what the bar, feed and composer say changes. The action bar is one row at any width (the branch truncates, the least important facts drop out, the buttons never wrap under it), and the composer no longer vanishes on a session that ended without a resumable id: it stays and starts a new session instead.
- 85c5f73: Onboarding checklist and a settings page (#958).

  The Overview gains an **Onboarding** section: add a project (one click for the directory the server runs in), fill the AI task queue, fill `tickets/` (with an "Import tickets from GitHub" button), add the Discord bot, turn on browser notifications, and add Discord notifications. Every step's done-state is derived from a real fact (a registered project, a non-empty queue, a ticket on disk, a granted browser permission, credentials the daemon holds), so a step cannot be ticked by clicking it, and one done outside the dashboard shows up done. It can be dismissed, which hides it only on the Overview.

  Settings now have a page of their own at `/settings`, reachable from the header, collecting what was spread across the header menus: appearance and editor, agent / model / run-on, run options, eco, notifications, and automation. The Onboarding checklist lives there too and is not dismissible, which is what dismissing it on the Overview points you to.

  Supporting changes: `onDashboard`'s per-project rollup carries `hasTickets`, a new `onOnboarding` read offers the server's working directory as a first project (gated on the same wiring as adding projects, so a public host discloses nothing), and `onboardingDismissed` joins the preferences.

- d3cd883: Custom presets can now be saved to a project, not just to you. When you create a preset with a project open, a "Save to" choice lets you keep it private (as before) or commit it into the repo's `.the-framework/custom-presets.json`, so everyone who clones the project gets it. Shared presets show up in their own "Project presets" group in the Presets menu and under `/` in the editor, and delete from there. Personal presets still live in your home config and follow you across every project.
- 30e94f9: feat(framework): run a session on a connected device via a server-side relay (#1067, slice 1)

  Picking a saved device in the "Run on" gear now makes it a true run target: you stay on this dashboard, submit, and the session runs on the remote device and streams its events back into the current run view. A device row no longer navigates the browser; it selects the device in place (the token stays a per-browser secret, memory-only, never persisted).

  Under the hood the local daemon relays the run: it POSTs the run to the remote daemon's new `/_relay/start` (authenticating with the device token as the `fw_daemon` cookie, no Origin) and fetch-streams the remote's `/_relay/events` back into the local run view over the normal same-origin channel. The browser never talks cross-origin and the token never leaves the two daemons. Both `/_relay/*` endpoints are fronted by the same #1051 token guard.

  Slice 1 is submit + live events. The remote run executes in the device's own home checkout, and the diff, PR, push/handoff, and browser screencast panels show a "not available for remote runs yet" placeholder; those (and per-project remote targeting) land in later slices.

- 38ef437: A run started on a connected device is now a true peer: its file reads, diffs, git status, worktree, run-handoff, live steering, and push/open-PR all work by relaying each run-scoped RPC to the device over the #1051 token cookie, keyed by a durable per-run marker on the local daemon; push and PR run on the device's own checkout. The run view's diff and handoff panels are no longer suppressed for remote runs (#1067, slice 2). The browser preview stays local-only for now (slice 3).
- 1c8d520: A run relayed to a connected device (#1067) now appears in the local project's session list and re-opens after a dashboard reload, instead of showing "This session is gone". The local daemon keeps a lightweight in-memory RunMeta for each relayed run (target 'remote', the device label, a status that flips when the relay stream ends) and merges it into the run list; the event backlog already survives via the daemon-side stream (#1077).
- 3bc2a2e: Make a remote run's session-list row accurate and legible (#1067). The local in-memory stub for a relayed run now folds every streamed event through the store's own reducer, so it mirrors the device: it shows WAITING while the run is parked on you (not a permanent RUNNING), settles to the right terminal status, and picks up the agent logo and any pending-choice state. The row also gets a small device glyph (with the device name on hover) so a session running on a connected device is distinguishable at a glance from a local one.
- df6ac36: Run target: wire GitHub Actions into the "Run on" gear (#1050). The options gear gains a single-select "Run on" submenu (Current device, the default; GitHub Actions; Claude web as a disabled placeholder), and picking GitHub Actions runs the turn on a fresh Actions runner via the already-merged ActionsDriver instead of on this device. The choice sticks per project like the agent and model. A new `--run-on <local|actions>` flag drives it from the CLI; `actions` reads the repo owner/repo from the origin remote and a user token from `GH_TOKEN` (repo + workflow scopes). `local` is unchanged.
- 9202800: Run-view polish for a GitHub Actions target (#1053). A run started with `--run-on actions` now records its target on the run's meta, and the run view reads it: instead of an apparently-stalled live feed (the ActionsDriver replays its transcript in a burst at the end, on a fresh runner per turn), it shows a "running on GitHub Actions, updates arrive when the run finishes" affordance with a clickable link through to the live Actions run (from the `action`/`notice` events the driver emits, which carry the run's `html_url`). The right rail's Browser pane is gated off for an Actions run, since there is no browser on the runner to screencast. A local or remote-device run is unchanged.
- c55dcca: Dashboard: a stopped session can be deleted. The sessions rail only ever grew — remove-worktree reclaimed a checkout on disk but kept the row, and nothing removed the record. Delete (a trash button beside Remove, which is now a folder-x icon so the two read apart) takes the session out of the dashboard: its run record and event log, and its worktree if one remains. It confirms first, because unlike remove-worktree the replayable history can't be recovered. It deliberately leaves the git branch and its commits, the committed `LOGS.md` line and the conversation record — deleting a branch that may carry merged work or an open PR is not something a trash icon should do silently. It refuses while a run is still going.
- 3dd90eb: Dashboard: the session's branch row fills in about three times faster. It was waiting on a `gh pr view` (≈574ms, against ~10ms for every git read beside it) that ran twice per session, on every navigation and every poll. That lookup is now read through a single-flight, stale-while-revalidate cache, and it no longer blocks the branch, dirty flag, size, commits or files — they render at git speed while the PR arrives behind them. Opening a PR invalidates the cached answer, and a lookup still in flight is reported as pending rather than as "no PR", so the Open PR button holds off instead of offering to open a second one.
- c2c5798: Dashboard: semantic status colours, a real Checkbox, a stable Sessions rail, and no emoji glyphs.

  The status colours are now four tokens (`--success`, `--warning`, `--danger`, `--info`) tuned per
  theme, replacing every raw palette value. Before this, "good" was six different greens, `amber-500`
  meant both "stopped" and "building, fine", and the flat `-500` tones sat near 2:1 contrast on the
  light canvas.

  Checkboxes are a shadcn-style primitive on Base UI instead of bare `<input type="checkbox">`, so
  they follow the theme and carry the same focus ring as everything else.

  The Sessions rail no longer collapses to a strip when the right rail opens the Browser or Views
  tab; its width is now constant.

  The ✅/❌/⚠️ glyphs in the Enhanced System Prompt disclosure are replaced by a status dot and plain
  text, matching how every other state in the app is drawn.

  Sessions rail rows now show which agent ran them, and lead with something that identifies the
  session: the agent's own session name or its branch when there is no typed prompt, and the start
  time when there is neither. They used to print a bold "(no prompt)" while the timestamp that
  actually told them apart sat beside it in small muted text.

  A clean git tree's dot is neutral rather than green. Green means "added / new / done" everywhere
  else, so a green dot for "nothing changed" sat one pane from the file tree's green dot for "this
  folder has changes".

  Claude's logo is its own starburst rather than the Anthropic wordmark.

- 6e4eb69: Dashboard: the session toolbar leads with the session's name — the same label the rail shows (your prompt) — instead of the branch. The agent renames its branch near the end of a run, and with the branch as the headline that mutation read as the whole view changing; as muted git context beside a stable name, it no longer does. The shared `the-framework/` prefix is dropped from the branch for legibility (the full name stays in the tooltip and copy). The branch summary also stops blanking for a beat when a run stops: it holds the last file counts until the handoff has loaded, so it swaps once instead of flashing empty. One line still, with the label truncating last and the branch, size and summary dropping out as the pane narrows.

### Patch Changes

- 9fd8951: Let the GitHub Actions run target (#1050) read back a run's work and continue on it (#1085). `claude-code-action@v1` leaves its `branch_name` output empty for a `workflow_dispatch` agent run, so the driver never learned the branch the agent pushed: `readCode` failed and a follow-up turn started over on `main`. The driver now names the branch itself (`claude/framework-<session>`) and passes it to the workflow, which pushes the run's work there and records it, so the diff view works and each turn builds on the last.
- c6548ca: Give each GitHub Actions run (`--run-on actions`, #1050) a correlation id that is unique across driver processes. The id seeded a per-process counter, so a fresh `framework run` process restarted it at 1 and every run's first turn was `actions-1-turn-1`; a new run could then match an earlier, identically named run still in the recent-runs window and report its stale result. The session id now mixes in a random tag, so a run only ever finds its own workflow run.
- 6740853: Never silently downgrade a run into your own checkout when its worktree could not be created (#997).

  Every run gets its own git worktree (#736) so the agent never edits the working tree you are sitting
  in. When `git worktree add` failed, the daemon logged a line and ran the agent in the project's main
  checkout instead, mixing its edits into your uncommitted work. That is reachable in normal use: on a
  large repo `worktree add` writes a whole checkout and can outrun its budget and be killed.

  A project that is not a git repo still falls back to the main checkout, which is the supported
  pre-#736 behavior. A project that _is_ a repo and whose `worktree add` failed now fails the Start
  instead, and the dashboard shows why. A failed Start is recoverable by starting it again; a checkout
  with agent edits mixed into it is not.

  A `worktree add` killed mid-write leaves the partial checkout it had already written behind (git
  drops its own administrative entry on the way out, so `git worktree prune` finds nothing to do), so
  that directory is now removed on the timeout path.

  The fallback's log line also says which case it is: "is not a git repository, so it gets no
  worktree" rather than a generic "no worktree" that read the same either way.

- 38bb24a: `gitTimeoutMs()` no longer mistakes the value of a global git option for the subcommand, and a
  conversation commit that keeps failing now says why.

  `gitTimeoutMs()` picked the subcommand by dropping every word that starts with `-`, which drops
  the flags but keeps the values of the global options that take one. `git -C /repo push` therefore
  read as the subcommand `/repo`, and the push silently got the 30s local-mutation budget instead of
  its intended 120s network budget. The same held for `-c key=val`, `--git-dir`, `--work-tree`,
  `--namespace` and `--exec-path`. The leading global options are now skipped properly, value and
  all, so the real subcommand is what picks the budget. No call site in the package passes `-C`
  today, so no timeout that was already correct changes; this closes the trap before a future call
  site falls into it. `gitTimeoutMs()`'s signature is unchanged.

  The conversation committer logged only its successes. `commitConversations()` returns a reason
  when it declines or fails, and the poller dropped it, so a project whose commit failed every tick
  re-queued itself forever while printing nothing at all. The reason is now logged, but on change
  only: the first failure prints one line, and repeats of the same reason stay quiet until the
  reason changes or the commit lands, so a stuck project cannot flood the daemon log one line per
  poll window. The ordinary "no conversation changes" outcome is never reported as a failure.

- fd8e13f: Stop a throwing onEvent listener from escaping a prompt run (runPrompt).

  runFramework wraps each `opts.onEvent(event)` call in a try/catch and logs-and-ignores a listener
  that throws, but runPrompt's emit did not. Because emit is called both inside and outside the run's
  try block (the session-start and system-prompt events fire before it), an onEvent listener that threw
  could escape runPrompt uncaught, or skip the run's `end` event. runPrompt now guards the listener the
  same way, so a bad listener can no longer take the run down.

- 96f7b6d: Dashboard launcher polish. The run Context picker is now a dropdown that sits in the composer control row next to the presets button, instead of an inline section that pushed the form down. The options gear moved next to the model selector, before Send, and shows a small presence dot rather than a count. "Enhanced System Prompt" is now a dropdown too, sharing the "In play" row. Every menu trigger stays highlighted while its menu is open, and menus open toward the side with room. The prompt editor and all dropdowns now scroll through the shared thin overlay scrollbar, which also removes the doubled border/track the native bar left inside popups.
- c9864a6: Dashboard: fix the Usage card's dividers rendering at full text brightness, and stop the
  Overview cards stretching into empty space.

  Tailwind v4 defaults an uncoloured `border-t` to `currentColor`, so the three dividers in the
  Usage card painted at `oklch(0.95 0 0)`, the body text colour, against hairlines that are
  `oklch(0.3 0.01 264)` everywhere else in the app. They now use the border token.

  The two Overview card rows also stretched each card to its neighbour's height, so on a quiet
  board half of "Session outcomes" and most of "Working now" were empty card. They are now two
  column stacks that size to their content, which pairs the tall chart against the tall list and
  brings the Projects table a full screen higher.

- deb130e: Dashboard: the "New preset" form is now a centered modal dialog instead of a panel that pushed the composer controls down. Same fields (name, prompt, and the "Save to" scope choice); a backdrop click, Esc, or the close button dismisses it. Adds a reusable shadcn-style `Dialog` on Base UI for future forms.
- 8a8cd75: Dashboard: make the `dark:` utilities follow the theme toggle instead of the OS.

  Tailwind v4 compiles `dark:` to `@media (prefers-color-scheme: dark)` unless a custom variant
  says otherwise, but the dashboard's tokens live on the `.dark` class that LayoutDefault toggles.
  The two disagreed: picking Dark on a light OS applied the dark tokens while leaving every
  `dark:text-*` rule unapplied, so diff counts, the stream-lost banner and the daemon-health banner
  kept their light-mode colours on a dark canvas (and the reverse on a dark OS set to Light).
  Declaring `@custom-variant dark` binds both to the same signal.

- decace4: **Breaking (`@gemstack/ai-autopilot`):** the framework-detection exports are renamed so they no
  longer collide with the user-facing domain presets.

  Two unrelated subsystems were distinguished only by a directory's singular-vs-plural: `src/preset/`
  (the Open Loop domain bundles, `{loops, prompts}`) and `src/presets/` (framework detection). Both
  were re-exported side by side from the one entry point, so `definePreset` and `selectPreset` read
  like a pair while being from different subsystems. "Preset" now means the user-facing domain bundle
  only, which is what the shipped root `presets/` markdown and the dashboard already meant by it.

  `src/presets/` moves to `src/framework-detection/` (internal), and the exports rename:

  | Before                  | After                            |
  | ----------------------- | -------------------------------- |
  | `definePreset`          | `defineFrameworkPreset`          |
  | `Preset`                | `FrameworkPreset`                |
  | `PresetSpec`            | `FrameworkPresetSpec`            |
  | `PresetSignals`         | `FrameworkPresetSignals`         |
  | `PresetScore`           | `FrameworkPresetScore`           |
  | `PresetRegistry`        | `FrameworkPresetRegistry`        |
  | `PresetError`           | `FrameworkPresetError`           |
  | `builtinPresets`        | `builtinFrameworkPresets`        |
  | `builtinPresetRegistry` | `builtinFrameworkPresetRegistry` |

  `detectFramework`, `vikePreset`, `nextPreset`, `FrameworkSignals` and `FrameworkDetection` are
  unchanged: they were already unambiguous. The domain-preset exports (`defineDomainPreset`,
  `selectPreset`, `composeDomainPresets`, `loadDomainPreset`, `builtinDomainPresets`,
  `builtinPresetsDir`, ...) are unchanged.

  No behavior change. As a side effect `@gemstack/ai-autopilot` no longer exports a `definePreset`
  that clashes with the unrelated `definePreset` in `@gemstack/the-framework`.

- ca48f85: Fix a remote run vanishing from the session list on a dashboard reload ("This session is gone"). `onRuns` read the relayed-run stubs through `contextRemote()` after two awaits, but telefunc only exposes `getContext()` synchronously at the top of a telefunction, so the call threw and every remote run was silently dropped from the list. The context is now read before the first await, so a relayed run stays in the list and re-opens after a reload as #1077 intended.
- 6601c44: fix(framework): set the daemon token cookie SameSite=Lax so the "a device I have" connection hop works

  The non-loopback bind guard (#1051) set the fw_daemon cookie SameSite=Strict. Connecting to a saved device (#1052) is a cross-origin top-level navigation, and a Strict cookie set during that navigation is withheld by the browser on the immediate redirect to the clean path, so the device connect landed on a 401. Lax still rides top-level GET navigations, and CSRF protection is unchanged (the same-origin check still fronts /\_telefunc).

- ef4f007: Dashboard: the session log labels each row with a plain word instead of its internal event name (#1035). The badge used to show the raw event kind, so a turn of the AI read `DRIVER`, the paused state read `SETTLED`, and the spend row read `USAGE`. These now read `AGENT`, `WAITING`, and `COST`, and the resume-link row reads `RESUME`. Kinds that were already clear are unchanged.
- 8154e20: Dashboard: widen the session-log badge column so "SYSTEM PROMPT" fits on one line. The badge column was narrow enough that the one two-word label wrapped to two lines; the column now fits it (measured at 106px, column is 112px).
- Updated dependencies [decace4]
  - @gemstack/ai-autopilot@0.12.0

## 1.1.0

### Minor Changes

- 5100ecf: Git operations get a timeout budget chosen by subcommand, and a timeout is now distinguishable
  from a command git rejected.

  One flat 10s budget covered every git invocation in the package, the repo's ~20 call sites, which
  meant the two slowest ran under what is really a read's budget. `git worktree add` writes a whole
  checkout and `git push` uploads a packfile; on a large repo both routinely pass 10s, at which
  point `execFile` SIGTERMs them. A killed `worktree add` drops a run into the user's main checkout
  instead of its own worktree, and a killed `push` may have half-landed on the remote.

  `nodeGitRunner()` now picks the budget from the args: 10s for reads (`status`, `rev-parse`,
  `ls-files`, `log`, `diff`, `show`, `remote`, `rev-list`, `symbolic-ref`, `branch --list`,
  `worktree list`), 30s for local mutations (`add`, `commit`, `init`, `checkout`,
  `worktree remove`, `worktree prune`), and 120s for the network and for a full checkout (`push`,
  `fetch`, `pull`, `clone`, `worktree add`). Reads deliberately keep the old budget: widening
  everything to cover a slow op would let a hung read hold the daemon six times longer. This
  mirrors the read/write split `gh` already had.

  A CLI killed for outrunning its budget now rejects with a `CliTimeoutError` reading
  `git push --set-upstream origin <branch> timed out after 120000ms`, rather than the bare
  `Command failed: git push ...` that a SIGTERM with empty stderr used to produce. `isCliTimeout()`
  tells the two apart programmatically.

  `nodeGitRunner()`'s signature is unchanged; the budget is derived from the args, so every existing
  call site gets the right one with no change. New exports: `gitTimeoutMs`, `GIT_READ_TIMEOUT_MS`,
  `GIT_WRITE_TIMEOUT_MS`, `GIT_SLOW_TIMEOUT_MS`, `CliTimeoutError`, `isCliTimeout` and the
  `CliTimeout` type. `CliRunnerOptions.timeoutMs` accepts a function of the args as well as a number.

### Patch Changes

- 7a04eeb: The user registry (`~/.the-framework.json`) is now written atomically, and its mutators are
  serialized.

  The file holds the project list, the global preferences and every per-project override, and it
  was written with a plain truncate-then-write while the reader treated a malformed file as an
  empty registry. A crash, a kill or a full disk mid-write therefore erased all of it silently and
  the next read reported a clean slate. The write now goes to a temp file beside the real one and
  is renamed over it, the same shape the daemon state file got in #922, so a reader sees either
  the whole old file or the whole new one and a failed write only damages the temp.

  `addProject`, `removeProject`, `writePreferences` and `writeProjectPreferences` each read the
  whole registry, edit it and write it back, and one daemon runs several concurrently. Interleaved,
  the later write was computed from a read taken before the earlier one landed and silently dropped
  it. They now queue through a single tail promise.

  `RegistryFs` gains an optional `rename`; the node-backed implementation always provides it.

- 2fc8790: Removing a retained worktree no longer destroys the uncommitted work it was kept for (#982)

  A worktree is only retained when its session failed or was stopped, which is exactly when the
  checkout is still holding an uncommitted diff. Both surfaces that offer to remove one, the
  `framework worktrees rm` verb and the dashboard's Remove button, went straight to a removal that
  falls back to `git worktree remove --force`, so the work was deleted with the directory and there
  was nothing left to recover it from.

  Both now commit the checkout to the session's own branch first, the way the daemon's teardown
  already does, and refuse the removal when that commit fails, keeping the checkout instead. The
  two surfaces are now one implementation, so the session-still-running refusal, the unknown-session
  check and the new commit-first behaviour are identical on both. Removing a session that has no
  worktree now reports that instead of the dashboard reporting success.

- 23cad81: Stop a failed log tail from killing the daemon. `followFile`'s pump had no `catch` and every caller discarded its promise, so a rejected read (EIO on a network mount, EISDIR, a log grown past `kMaxLength`) surfaced as an unhandled rejection and exited the process, taking every connected dashboard stream with it. The same function installed no `'error'` listener on its `FSWatcher`, where an error event with no listener throws out of the emitter. Both are now absorbed, and the poll backstop carries the tail on its own once a watcher is lost.
- Updated dependencies [8bf9d20]
  - @gemstack/ai-autopilot@0.11.1

## 1.0.0

### Major Changes

- 1e3647b: Presets are one catalog instead of thirteen modules, and the notifier keys plus the
  preference defaults have a single home shared with the dashboard.

  Breaking, public API. The 56 per-preset exports (`RESEARCH_PRESET_NAME`,
  `RESEARCH_PARAMS`, `RESEARCH_PROMPT_TEMPLATE`, `renderResearchPrompt`, and the same
  four for each of the other thirteen presets) are replaced by one `presets` record
  plus `LAUNCHER_PRESETS`: `renderResearchPrompt(what)` becomes
  `presets.research.render(what)`, and `RESEARCH_PRESET_NAME` becomes
  `presets.research.name`. `definePreset` now takes a spec object rather than three
  positional arguments.

  Also removed: `nodeGhPrLister`, `nodeGhBranchPrLookup` and `nodeGhPrLookup`, replaced
  by `ghPrView` / `ghPrList` in the new `gh` module; `startInterventionWatcher` /
  `startActivityWatcher` / `InterventionTracker` / `ActivityTracker`, replaced by
  `startKeyedWatcher`; and `postDiscord`, now `postInterventionsDiscord` beside the type
  it formats.

  Fixes a latent bug while doing so: `RunMeta.updatedAt` was stamped with the run's start
  time on every event, so everything that orders by recency (the overview, the activity
  feed, the interventions queue) was sorting on a constant.

### Minor Changes

- 4c89b8a: Auto maintenance: sweep the codebase on a schedule (#882)

  Auto PM now fires the [Maintenance] preset (#881) for a project that has not had a codebase-wide
  sweep in a week, ahead of its usual quick-wins/spike-and-plan rotation. The sweep only queues
  follow-up entries, so the backlog loop still does the work one bounded piece at a time.

  This reaches what session-scoped maintenance cannot: a repo that adopted The Framework late has a
  whole history no session ever touched.

  The schedule is a per-repo `sweptAt` in the existing `.the-framework/maintenance.json`, so it
  survives a daemon restart, and it is kept separate from the commit-delta sweep's `reviewedSha` so
  the two features cannot reset each other. There is no new setting: it rides the existing `autoPm`
  toggle and the quota boundary.

- 296b559: Auto PM: harvest quick-wins out of the plans we already have (#773)

  Adds a [Quick wins] preset — "look at all tickets/\*\*.plan.md and add all quick-wins to
  TODO_AGENTS.md" — and puts it in the auto-PM cycle ahead of [Spike & plan], so an idle
  machine harvests the plans it has before writing more.

  That closes the loop: tickets become plans (#685), plans become queued work (#773), and
  the backlog loop drains the queue.

- 8857670: Auto PM: spike & plan tickets with the quota that would otherwise expire (#685)

  When the agent queue has run dry, nothing is running, and every enabled consumption
  limit still has half its budget free, the daemon starts a PM run by itself: it spikes
  and plans the tickets that have neither yet, so the backlog refills unattended.

  Off by default (`autoPm`), and switched on from the Usage panel. The quota gate fails
  closed, unlike the per-run guard: no reading means no run.

- 6ed8f90: Show the run's browser in the run view. The stream shipped in #802 but nothing rendered it, and its URL only ever went to stdout, which a dashboard-started run discards. The run now publishes the port on its event log, the daemon proxies the stream and the input POST so the pane is same-origin, and the right rail gains a Browser tab that renders the frames and relays clicks and keys back to the page.
- aeb4f09: The daemon now commits the conversations it records on a project's main checkout, so a chat reaches the Git repo without waiting for someone to commit it by hand. A run's own worktree already swept its transcript on teardown; a conversation held in the checkout itself had nothing doing the same, and sat as an uncommitted change indefinitely. The commit is scoped to `.the-framework/conversations` and never stages anything else, so work in progress elsewhere in the checkout, staged or not, is left exactly as it was. It is debounced on an idle window rather than committed per turn, batching a burst of chat into one commit, with a cap so a conversation that never falls idle still lands. A repo that is mid-rebase, mid-merge or holding its index lock is skipped and retried later rather than committed into, and the daemon flushes anything still pending as it shuts down.
- a2a35be: Config layers now resolve by precedence, so a layer can turn a mode off (#841)

  The layers used to combine with OR: a flag could only ever turn a mode on, and
  `the-framework.yml` could only ever turn one on. Neither could say `false`, so a repo
  that committed `autopilot: true` gave every run in it autopilot with no way back.

  The layers now feed one resolve helper where the nearest layer that _set_ a key wins and
  a layer that said nothing does not participate. Absent stays absent, so an existing setup
  resolves exactly as before; the change is that an explicit `false` in a nearer layer now
  wins. `--no-autopilot`, `--no-technical`, `--no-vanilla` and `--no-transparent` give a run
  that nearer `false`, and the startup line now narrates which layer won each key
  (`◆ config: preset=software-development (the-framework.yml), autopilot=off (flag)`).

- b5300a6: A committed conversation now records the surface each turn came through, so a chat held in Discord reads as `discord` instead of being filed under the dashboard. The control channel's message entries carry an optional origin, the run attributes each turn to it, and an agent's reply inherits the origin of the message it answers, so a question and its answer stay one exchange. A run the daemon starts on a surface's behalf is tagged with `--via`, which keeps a chat-started session's opening turn from being attributed to the wrong place. Turns that name no surface fall back to the local one exactly as before, and entries written before this still parse. Transport names are validated where they enter, since they are written into a line-parsed conversation heading and a forged one could otherwise fake a turn.
- 137aecd: Dashboard UX sweep (#948): every UI flow reviewed and the low scorers fixed. A lost live stream and a dead daemon now announce themselves (with automatic recovery), a session that crashed or was stopped no longer reads "finished", the replay opens at the outcome, choice gates and chat sends show sending/queued/error states instead of failing silently, presets get a visible menu with one management home, deleted @/# chips release their context focus, agent views render tables and links, the prompt preview includes the repo SYSTEM.md (#872), the browser panel recovers from a transient stream error (#946), the in-session gear stops offering spawn-time options as session state (#833), Discord toggles say when the daemon cannot deliver, and a broad accessibility pass (labels, roles, focus management) across menus, dialogs and icon buttons.
- 3fc09a2: A session's answers now come back to the Discord channel that asked for them. Until now the bot acknowledged a message and nothing else followed, so you could talk to an agent from Discord but had to open the dashboard to read what it said. The bot binds a run to the channel it was addressed from, and a watcher posts each new agent turn there as it lands, reusing the committed conversation as the source since that holds the settled reply rather than raw console output. Binding adopts whatever the session has already said, so attaching to a long-running session never replays its backlog into a channel, and while the bot is switched off the cursor still advances, so turning it on starts from now rather than flushing everything said meanwhile. A run nobody addressed from Discord is not mirrored at all.
- 3c8a606: Chat to The Framework from Discord (#680)

  Discord was outbound-only: the daemon posts a webhook message when something needs you (#627), but
  a webhook cannot read a reply, so answering meant leaving Discord and opening the dashboard.

  The daemon now runs a Discord bot. Message it and it starts a session; message it again while that
  session is running and the text reaches the run through the same control channel the dashboard's
  live chat uses (#714). When a run parks on a question, the bot posts the numbered options and a
  reply of `2` answers it. `!status`, `!stop` and `!help` do what they say. `Ctrl+C` takes the bot
  offline with the rest of the daemon.

  Chat history goes where #857 asked for it: a message routed into a run lands in that run's
  conversation under `.the-framework/conversations/` (#908), committed with the repo. Nothing about
  the chat is stored outside git.

  Two gates, mirroring the notification watchers: a `DISCORD_BOT_TOKEN` (how to connect) and the new
  `discordBot` preference (whether to), read per message so the toggle applies without a restart.
  Both absent by default — unlike a notification, this one acts on what it reads. Set
  `DISCORD_CHANNEL_ID` to confine it to one channel.

  The gateway client is hand-rolled over node's global `WebSocket` rather than adding `discord.js`,
  keeping the package's three runtime dependencies intact, and reconnects with exponential backoff so
  a refused connection never becomes a tight loop.

- c7a0bde: Run concurrently on one project, each run in its own git worktree (#736). A dashboard-started run is now given a worktree under the project's `.the-framework/worktrees/<runId>`, on a `the-framework/run-<runId>` branch, and spawned with that as its `--cwd`. Because the runs no longer share a working tree, the one-run-per-project refusal (#393) is gone: the cap is unbounded, and Start is only refused for a duplicate of the same checkout. The user's own checkout is never touched, so a run no longer commits their uncommitted work to get started.

  Three supporting pieces. The daemon allocates the run id up front and passes it as `--run-id`, so the worktree directory and the run recorded inside it are one string. A fresh worktree has no `node_modules` (it is gitignored), so the parent checkout's dependency trees, workspace packages included, are symlinked in rather than copied or reinstalled. And the run renames its branch to `the-framework/<sessionName>` once the agent names the session, leaving it on the run-id name if the agent already branched itself.

  A project that cannot be given a worktree (not a git repo, or any git failure) falls back to running in the main checkout, and keeps its previous limit of one run at a time.

- 5c2679b: Retire a run's worktree when it finishes, keeping the ones worth looking at (#737). A run's history lives inside its worktree since #736, so it is now copied into the project's own `runs/` when the run ends, and only then is the checkout considered for removal.

  The retention rule: a run that finished cleanly has nothing left to inspect, so its worktree goes. A run that failed or was stopped keeps its checkout, because that is exactly when the half-finished working tree and the diff it died holding are worth seeing. Nothing is removed on a timer; a retained worktree goes when you remove it, via a Remove action on the finished run in the dashboard.

  A daemon that dies mid-run never runs that teardown, so the boot-time reconcile now sweeps the worktrees too: each orphaned run is flipped out of `running` and its history rescued into the project, with the checkout left on disk (a run that ended that way did not end cleanly).

  New surface: `archiveWorktreeRun` and `listWorktreeDirs` in the store, `onRetainedWorktrees` and `sendRemoveWorktree` as RPCs. Removal refuses while the run is still live, since Stop is how a run ends.

- 1c97dcb: Show every live run of a project, not just one (#738). Since #736 each run lives in its own worktree and writes its `run.json` there, so `readLiveMeta(projectPath)` stopped seeing any of them and the dashboard went blind to dashboard-started runs. A new `readLiveMetas(cwd)` discovers the live run in each `.the-framework/worktrees/*` checkout plus the project root (where a non-git project still runs, and where pre-#736 runs live), self-healing a stale one exactly as the single reader did.

  Every reader now aggregates: the runs list, the "working now" overview, the awaiting-you queue, the activity feed, and the project summaries. Each live run carries the `cwd` of the checkout it is editing, and `ActiveRun` and an `awaiting` intervention now carry a `runId`, so two concurrent runs of one project are told apart. `onGitStatus`, `onProjectFileStatus`, and `onProjectFiles` take an optional `runId` and read that run's worktree rather than the user's checkout.

  Also fixes a #736 bug found on the way: a repo's `.gitignore` says `node_modules/`, and a trailing slash matches a directory, not the symlink the worktree gets. The links were therefore untracked in every run's worktree, so a run's `git add -A` would commit dangling absolute symlinks onto its branch. The rule now goes into the repository's `info/exclude`, which is where git resolves excludes from for a linked worktree.

  Two dashboard fixes fall out: the "working now" list keyed its rows by project id alone, which produced duplicate React keys with two live runs in one project, and following live highlighted every running row at once instead of the newest.

- b6e6c82: Watch and steer a run in its own worktree (#749). #738 made concurrent runs visible; they were still not watchable or steerable, because the live event stream and the control channel were addressed by project while a run reads and writes inside its worktree (#736). The feed for a worktree run was therefore empty, and Stop, mid-run messages and choice picks were written to a log nothing was tailing.

  `onEvents` now takes an optional run id and tails that run's own `events.jsonl`, so selecting one run or another shows that run's output rather than the same empty feed. `sendStop`, `sendMessage` and `sendChoice` take the run id too and append to that run's `control.jsonl`, which is the file the run tails. Both resolve through the shared `resolveRunPath`, so an unknown or finished run id falls back to the project root, and omitting the id keeps the pre-#736 behavior for a run that has no worktree.

  The dashboard threads the selected run through the feed subscription and every steering control, and resubscribes when you switch runs.

- 312f993: Surface the theme control and give the navbar launcher its run controls (#754, #755).

  The theme has been switchable since #725, but it lived inside the per-run options gear: an app-wide appearance setting filed under one run's options, and absent entirely on a screen showing only the navbar, so it was effectively unreachable. It is now a control in the header, reading and writing the same `preferences.theme` as before. The gear drops its copy, so there is one home for it rather than two.

  The navbar quick launcher rendered an editor and a Start button and nothing else, so a run started there used the stored agent, model and options with nothing on screen saying which. It now carries the same agent/model select and options gear as the full composer, sharing one definition rather than a compact-only duplicate, and stays a single row so the header does not grow.

  The `dashboard` badge beside the wordmark is gone.

- 0d15eb6: Tighten the composer (#756). The prompt area reserved room for text nobody had typed: a resting height of `4.5rem` in the full form, with the control row and its containers padded to match. The editor grows with its content up to the same maximum as before, so the tall empty box bought nothing.

  The resting height drops to `2.75rem` (`2rem` in the navbar), the editor's vertical padding and the gap to the control row tighten, the submit button matches the size of the agent/model and options controls beside it rather than standing a size larger, and the three frames around it (`RunChat`, `RunResumeChat`, `StartRunForm`) lose a step of padding.

  Scoped to the composer on purpose: the prompt, its send button, the model select and the options gear.

- 0d15eb6: Adopt the brand mark (#757). The hexknot from the brand generator replaces the bare wordmark in the dashboard header and the relay view, and ships as the tab favicon.

  Its six strands carry a neutral ramp that runs dark-to-light, which would sink the leading strands into a dark canvas, so the fills are CSS variables: the brand values in light, a lightened ramp in dark. Not `currentColor` with per-strand opacity, which is the usual way to make an SVG theme-aware but is wrong for a knot: the over/under crossings are literal overlaps, so any strand below full opacity shows the one beneath it through the crossing. The favicon carries its own `prefers-color-scheme` ramp inside the file, since a tab icon follows the OS theme rather than the in-app choice.

- 504626d: Messaging a stopped run continues that run instead of opening a new one (#762). Sending a message to a run that had ended spawned a fresh run carrying the old session id: the agent conversation continued, but the history showed an unrelated-looking second row, so one thing you asked for looked like two.

  The follow-up is still its own process; what changed is where it writes. `sendStart` takes the run to continue, and the daemon reuses that run's id, its worktree and its branch rather than allocating new ones, restoring the run's archived history into the checkout when teardown (#737) had already removed it. The run then reopens its own log instead of truncating it, keeping its original intent and pass count and flipping back to `running` under the new process. One run, one row, one branch.

  Falls back to starting a new run whenever continuing is not possible: no worktree to attach, no branch left, or nothing archived to restore.

- 6f2901f: Address a session by URL (#784). The dashboard's selection is now its address: `/` is the Overview, `/{projectId}` a project's home, `/{projectId}/{sessionId}` one session. A session is a link you can paste, reload, bookmark, and open two of side by side, and Back/Forward walk the sessions you looked at. Selection used to be three pieces of React state reconciled at render, which is where #761/#766/#768/#774 all came from; a route cannot disagree with itself. A URL naming a session or project that no longer exists says so rather than silently bouncing you elsewhere.
- e834f82: Tell a settled session from a working one (#785). A run that finished its work stays open as a conversation, so it kept reporting `running` with a pulsing dot until the user closed it, whether the agent was mid-edit or had been idle for an hour. A run now says when it parks (`settled` event, `RunMeta.settledAt`), and the sessions rail reads "waiting" with a still dot instead of animating at you.
- a42c0b7: Ticket format: specify `tickets/<DATE>_<SLUG>.plan.md`, the detailed plan that sits beside a ticket and its spike. An agent writing one now has the shape (TLDR, Plan, optional Hard problems and Variability) and, for a low-rated aspect with alternatives, presents them with showChoices() and AWAIT instead of picking silently.
- c9e777e: `--browser` now runs against a Chrome the framework launches and stops with the run, instead of letting chrome-devtools-mcp launch its own. The debug port is open, so a second client can attach to the very page the agent is on — the prerequisite for streaming that browser to a human who needs to step in (#609). On a machine with no Chrome, `--browser` falls back to exactly what it did before.
- c9e777e: An agent working in a browser can now hand it to a human instead of failing. When it hits a login wall, a captcha, or an SSO step, it ends the turn with an `await-browser` block; the run parks, the user acts on the page, and the agent continues with whether it was handled. It never types a password and never attempts a captcha. An unattended run answers "could not handle it", so an agent is never told a human cleared a wall that is still there.
- 5dfa1a1: Serve a session's own worktree (#797). Preview was keyed by project and always booted the project's checkout, so pressing Serve inside a session showed you an app built from code that session never wrote, and two live sessions shared one preview. A session now serves the worktree it is working in, the project home keeps serving the main checkout, and the two run side by side. Stop and status are addressed the same way, the servable-app picker lists what the session's branch actually has, and a worktree's preview is stopped before its checkout is removed.
- b9128e0: Show a session's worktree in its action bar (#798). Every session runs in its own git worktree, and the dashboard said so nowhere: the git status bar reads the project, so a session's branch, its uncommitted work, and the directory holding both were invisible from the one view about that session. The action bar now carries a chip with the branch, a marker when the checkout is dirty, and — once the run is no longer live — what that worktree costs on disk, next to the Remove button that offers to reclaim it. Clicking opens that checkout in your editor rather than the project's.
- 773ca7d: End of session: surface the branch and diff, offer push and PR (#799)

  A finished session now reports what it produced and what to do with it. The dashboard shows the branch the work landed on, its commits, its changed files and the line counts, and offers Push branch and Open PR as buttons rather than describing them. A session that changed nothing says so instead of showing an empty branch.

  The read is branch-addressed rather than worktree-addressed, so it survives teardown: a clean run's worktree is removed when it finishes, and a checkout-based read then falls back to the project root and reports the project's own branch as though it were the session's. The branch each run left its work on is now recorded in its run meta while the worktree still exists, since the #326 prompt lets the agent name its own branch and neither derivation is reliable after the fact.

  New: `onRunHandoff`, `sendPushBranch` and `sendOpenPullRequest` RPCs, and `readRunHandoff` / `pushRunBranch` / `openRunPullRequest` with injectable git and gh seams. Degrades rather than fails when there is no remote, no `gh`, or no git repo.

- 7041dc4: A run with `--browser` now serves a live view of the agent's browser. The run prints a preview URL; opening it shows what the agent sees, and clicks, typing, scrolling, and navigation go back to that page — so when the agent parks on an `await-browser` gate at a login wall or a captcha, a human can actually deal with it. The view follows the agent when it switches tabs. It binds to loopback only, and no frame is written to disk or into the run's event log.
- cab77e9: One action bar for the project home and a session (#809). The two pages styled the same facts twice: the project showed a git status row, a session showed its own differently-shaped worktree chip, and the session was missing the repo, folder and editor actions entirely — on the one page where opening a checkout in an editor matters most. Both halves are now shared and take an optional session id: the status reads that session's worktree (adding its size on disk and the PR its branch has), and GitHub, Open folder, Open in editor and Serve all address it.
- 8ecbac6: Hover a changed file in the tree to see its diff (#816). Adds `onFileDiff`, the first read that takes a caller-supplied path, guarded by `safeRepoPath`: repo-relative only, no traversal, no leading dash, never into `.git`. Tracked files diff against `HEAD` so a staged change still shows, an untracked file renders as all-added, and a patch is cut at 500 lines and says so.
- 867e66f: Show the session's file changes in the run output (#817). A Changes section above the event log lists every file the session touched with its line counts, each row expanding to the diff. Adds `onRunChanges`, one `git status` plus one `git diff --numstat` per poll rather than a diff per file. Derived from the worktree rather than the agent's tool calls, which carry a tool's name and not its arguments (#165), so it works for every agent and reports the outcome rather than the intent.
- a64c29a: Hover an unchanged file in the tree to preview its contents (#828). The hover card taught on changed files now works on every row: a changed file shows its diff, an unchanged one shows its numbered contents. Adds `onFileContent`, sharing the path guard and checkout resolution of `onFileDiff`, and picking the read from the status the tree already holds rather than a second server lookup.

  Also closes a real hole in that guard: the containment check compared the `resolve`d path, which does not follow symlinks, so a link inside the repo pointing outside it passed a textual check while the read left the checkout. Both reads now confine with `realpath`.

- 4e32eba: Tell the user when a finished run left work nobody pushed (#860)

  An unattended run writes code, commits it to its own branch, and stops. Nothing says so.

  The "needs you" queue only knew two things: a pull request already on GitHub, and a run parked on a
  choice gate. A finished run with committed work and no PR was neither, so nothing fired until
  someone had already opened the PR by hand. The overview lists only running runs, and the push
  button sits inside that one archived run.

  The queue now has a third kind: a finished run whose branch holds commits that were never pushed
  and never merged. It rides the existing watcher, so it reaches browser notifications and Discord
  like any other item.

  It only tells you. Pushing publishes the agent's work under your name, so that stays your click.

  Only the most recent finished runs per project are checked, since each one costs a few git reads on
  every poll.

- 8dc742f: The project log is the complete list of sessions (#898)

  `.the-framework/LOGS.md` is the one part of a project's run history that git keeps, but it only
  recorded runs that finished cleanly: a stopped or crashed session left nothing behind, even
  though the transient `runs/` archive had it. The entry is now written as the run settles, on
  every path out, so the committed log stops disagreeing with the machine's own record.

  Each entry also carries the run id, the name the agent gave the session, and the branch the
  work landed on, read from the checkout while it is still there. So an entry now says where to
  find the session and its code, rather than only that it happened.

- b05663f: Conversations are committed to the Git repo (#908)

  A project's chat was the one part of a run that git never kept. `LOGS.md` records that a session
  happened, and #898 made it the complete, joinable list of them, but what was actually said lived
  only in `.the-framework/`, which is transient by design (#313) — so a clone carried the index and
  none of the content.

  The chat now lands in `.the-framework/conversations/<runId>.md`, keyed by the same run id the
  project log records, so the committed session list and the committed chat join. One file per
  conversation and append-only, because run worktrees are live concurrently and each commits its own
  pending work on teardown; a single shared file would conflict every time two runs chatted at once.

  Only the human turns and the agent's replies are stored — not the verbose transcript, which stays
  with the model provider (#857).

  Message bodies stay multi-line and readable in a diff rather than being collapsed to one line the
  way a `LOGS.md` field is, so only a line's leading `#` or `\` is escaped. That is enough to keep a
  reply from forging a message, which is the same thing #897 fixed for the project log.

  The seeded `.the-framework/.gitignore` is an allow-list written once and only when absent, so every
  repo activated before this would have silently ignored its own conversations. It is upgraded in
  place on first write as well as seeded correctly on a fresh install.

- 206fc61: New preset: Import tickets from GitHub, and it always opens a session of its own (#959)

  The triage and planning presets all read `tickets/`, so a repo with an empty one has nothing
  for them to work from. This fills it from the repo's GitHub issues.

  It is the first preset marked `newSession`. Loaded from inside a session, every other preset
  is a message to that session; this one is not about the conversation at all, and appending it
  would put the import on that session's branch, behind its context. So both in-session
  composers send it as a new run instead, and the view follows it.

- e5e662a: The launcher shows what a session will actually run with (#842)

  `the-framework.yml` was read exactly once, inside the freshly spawned CLI child. The daemon never
  read it and the dashboard never saw it, so the gear could only ever show your own preferences
  while the repo's committed options quietly took effect later.

  The project payload now carries the repo file, read fresh on each request. The dashboard resolves
  the same layers the CLI does, nearest first: your project options, the repo's `the-framework.yml`,
  then your global preferences. The launcher lists what is in play inline, without opening the gear,
  and marks the values that come from the repo rather than from you.

  Because the launcher now resolves the repo file itself, a start sends the four toggles it owns
  (autopilot, technical, vanilla, transparent) explicitly, including `false`, which the CLI takes as
  the nearest layer. Turning one off in the gear no longer gets undone by the repo file. Runs the
  daemon starts on its own resolve through the same layers.

- bf35985: Add the [Maintenance] preset (#881)

  A codebase-wide sweep that queues work instead of doing it: for each subset that needs attention
  it appends a [Maintainability] and a [Security audit] entry to `TODO_AGENTS.md`, so the backlog
  loop does the actual refactoring later, one bounded piece at a time. [Readability] joins them
  only under `technical_control`.

  It complements the post-merge maintenance block, which only ever sees the changes one session
  introduced. A repo that adopted The Framework late has a whole history no session has touched,
  and this is what reaches it.

  Available as a preset button in the dashboard, and materialized to
  `.the-framework/presets/maintenance.md` like the other presets.

- 862ed73: Runs no longer outlive the daemon that spawned them. A shutting-down daemon stops the runs it started and records each one as resumable; the next daemon picks them back up in the same worktree, continuing the same agent conversation. Previously a stopped daemon left every in-flight run running on `ppid 1`, holding a worktree and sometimes a headless browser, with nothing left that knew about it. Runs suspended more than a day ago are dropped rather than resumed, and a run the daemon merely steers rather than spawned is left alone.
- 500bec7: Add `framework worktrees` for the checkouts sessions leave behind. `framework worktrees` lists them with the session's status, size on disk and branch; `framework worktrees rm <sessionId>` removes one, refusing while that session is still running; `framework worktrees prune` removes every one whose session is no longer running. Until now this cleanup existed only as a per-row button in the dashboard, so it could not be scripted, and a machine that had been running sessions for a while accumulated checkouts with no way to clear them from a terminal.
- 45d22aa: Run options default per project instead of globally. They lived in one `Preferences` object shared by every registered project, so the model you picked for a TypeScript monorepo silently followed you into a scratch prototype. A project now stores only the options it overrides, in a `projectPreferences` block keyed by project id, and anything it does not set still falls through to the global object. Choosing an option while a project is open sets it for that project; the user-level ones (theme, editor, notifications, saved presets) and the consumption limits stay global, as does everything chosen from the Overview. Existing registries read and behave exactly as before until something is overridden.
- d3d470e: Presets target the session they were launched from (#874)

  A preset's `what` param defaulted to the literal `this PR`. It now defaults to the session the
  preset was launched from, falling back to `entire codebase` when there is no session yet.

  `${{ }}` has always been JS-evaluated, but the default value was the one string that never went
  through the evaluator, so a `${{ }}` inside it reached the prompt as literal text. Defaults are
  now rendered against the same context as the preset body, and that context carries
  `session_name`, `presets` and `settings` — so a preset can also point at another preset's file
  path, which #881 needs.

  In the dashboard, a preset picked from a run page renders against that run's session; the
  launcher has no session and gets the codebase-wide default.

- ff5792c: Pace spending against a quota boundary instead of configured limits (#879)

  The Framework now spends up to a moving boundary derived from the account's own week:
  by the nth day of the quota week, at most n/7 of the week's allowance. The last day of
  the week allows all of it, so nothing is left on the floor. Work you ask for may cross
  the boundary and borrow against the days to come; unattended work stands down at it.

  There is nothing to configure. The three consumption limits, their preference
  (`consumptionLimits`) and their panel rows are gone, along with the rolling meter that
  derived usage by diffing readings. The boundary is a comparison of two numbers the
  agent reports, so it owes nothing to how long the daemon has been running.

  Removed from the public API: `ConsumptionMeter`, `consumptionStatus`, `budgetsFrom`,
  `DEFAULT_CONSUMPTION_LIMITS`, `CONSUMPTION_LIMIT_LABEL`, `resolveConsumptionLimits`,
  `FIVE_HOURS_MS`, `ONE_DAY_MS` and their types. Added: `quotaBoundaryStatus`,
  `boundaryFromResetsAt`, `parseResetsAt`, `QUOTA_WEEK_MS`. `QuotaView.limits` is replaced
  by `QuotaView.boundary`, and a run's `consumptionGate` now returns the label of the
  window that reached the boundary rather than a window enum.

- e8dab8e: The usage panel is one week-long bar, with the limit on a slider (#960)

  Usage used to be two flat meters: how much of the week was gone, and separately how much of it
  was allowed by now. They were the same axis drawn twice, so nothing on screen said the second
  was a line through the first.

  Now the track _is_ the week, edge to edge, labelled by day. The fill is what has been spent, a
  mark shows the boundary, and the colour is the two compared: green under it, blue tracking with
  it, orange ahead of it, red once the week is gone.

  The line unattended work stops at is now yours to move. It is stored as an offset from the
  boundary rather than a fixed percentage, so it travels with the boundary through the week
  instead of being overtaken by it. Centre is the previous behaviour, which is what an install
  that never touches the slider keeps.

- 7fced75: Add the [Suggest tickets to work on] preset (#698)

  Reads the repo's tickets, proposes the ones worth doing next as a multi-select with the
  high-confidence ones pre-ticked, waits for you, and adds only what you approve to
  `TODO_AGENTS.md`.

  The attended way to fill the agent queue. `/` menu items can now carry hover text, so the
  preset can say where its output lands.

- eff5f40: Tell the agent it has a browser. `--browser` wired the chrome-devtools tools into the run but the system channel never mentioned them, so the agent reached for `WebFetch` and the browser sat on `about:blank` for the whole run, taking the preview with it. Runs with a browser attached now get a short section saying it exists and that anything it needs to see or act on goes through those tools. Only when the tools are really there: the flag wires nothing on another agent or the fake driver.
- e62b60d: Ship a TODO_AGENTS.md format spec the agent can read (#880)

  The backlog had no written layout, so each agent invented one. The package now ships
  `prompts/todo_format.md`, and the context fragment points at it the same way it already
  points at the ticket format: by its `node_modules` path, so the layout versions with the
  package instead of going stale in a committed file.

  The format is a priority-sorted file with `## URGENT`, `## High priority`,
  `## Medium priority` and `## Low priority` sections. It needs no parser change, because
  entries are read in file order and headings are skipped, so a priority-sorted file drains
  in priority order.

- b4dce07: Add the [Do quick-win work] and [Do consensual work] triage presets (#891, #892)

  Both read `tickets/*.md`, pick the tickets matching one filter, and append them to
  `TODO_AGENTS.md`. They are how the agent queue refills itself from the ticket backlog, where
  [Quick wins] refills it from the `.plan.md` companions that already exist.

  The pair splits on cost: both are consensual (zero open questions, zero variability), so neither
  needs a human, and they differ only in whether the work is cheap. Keeping them apart lets the
  queue be refilled with the cheap batch and the significant batch on separate turns rather than in
  one indiscriminate sweep.

  Both join the auto-PM rotation, which now runs quick-wins, quick triage, consensual triage, then
  spike-and-plan: cheapest and readiest first, planning last. Each prompt pins its own session name
  and aborts when `the-framework/<SESSION_NAME>` already exists, so a firing that lands while the
  previous triage is still in flight does nothing instead of triaging the same tickets twice.

  Available as preset buttons in the dashboard.

- a47d2d9: The UX preset now rates every UI flow and fixes the low scorers on its own (#962)

  It used to enumerate findings, show them as choices, and stop at `<AWAIT>` for a human to
  pick from. That made it unusable unattended, and the ratings it produced were mostly 10/10,
  which is the failure mode where a review reports that everything is fine and changes nothing.

  The new prompt demands 100% coverage of the UI flows, a rated reason for each one, a separate
  commit per flow it improves, and a closing table of old rating => new rating. It names the
  all-10s answer as laziness up front, which is the part that makes the ratings honest. It runs
  to completion, so the launcher button is now labelled "UX (auto)"; a gated sibling that offers
  its ratings as choices is tracked separately.

### Patch Changes

- 38c8e80: Auto PM no longer spends the last of the quota after a daemon restart (#848)

  The consumption meter measures how much usage has gone up since it started watching,
  so a restarted daemon had nothing to compare its first reading against and reported
  zero consumed no matter what the account had actually spent. Auto PM read that as a
  full budget.

  It now also checks the account's own weekly figure, which is absolute and survives a
  restart, and refuses when that cannot be read.

- 02619cc: Auto PM now drains the agent queue as well as filling it (#855)

  Auto PM only ever put work into `TODO_AGENTS.md`, and nothing unattended took it out
  again: the backlog loop is a phase inside a run a human started, and auto PM's own runs
  go down the prompt path, which never reaches it. So the queue filled once and every
  later tick refused because it was no longer empty, and the daemon went quiet for good.

  A tick that finds open entries now starts a run for the first one instead of standing
  down, and goes back to harvesting quick-wins and planning tickets once the queue is dry.
  A queue that cannot be read at all is still a refusal. The refusal reason is logged each
  tick, so a wedged sweep no longer looks the same as a healthy idle one.

- ee78ce1: Auto PM now starts runs with the project's own settings (#858)

  An unattended run was started with no options at all, so it ignored the agent, the
  model, and every other per-project setting a launcher-started run would have honoured.
  A project configured for Codex had auto PM running Claude.

  The preferences to run-options mapping moved out of the dashboard client into the
  framework's browser-safe entry, so the daemon and the launcher now share one copy of it
  rather than two that can drift. `--unattended` is still forced on regardless of what the
  preferences say: that is a property of nobody watching, not something to configure.

- a0f5a64: Stopping auto PM now stops an in-flight sweep, not just its timer (#983)

  `stop()` only cleared the interval, so a sweep already inside its per-project loop kept
  going: it finished awaiting the git calls and queue reads, then spawned a run. During
  shutdown the daemon quiesces the background services and then clears its live-run map,
  so a run started in that window was tracked by nobody. It was never suspended and never
  terminated, leaving an orphan process holding a worktree and quota spent on a run that
  would never be seen.

  The sweep now carries a stopped flag, checked at the top of a tick and again immediately
  before a run is started, so the awaited window between the two no longer leaks a run.

- 0749c76: Make the logo the way home (#909). Clicking the mark or "The Framework" in the top bar goes to the Overview. It is a real link, so cmd-click and middle-click open a second Overview in a new tab and "copy link address" gives you a URL, while a plain click stays an in-app navigation with no reload.
- 770591a: Paint the browser preview's first frame. Chrome does not finalize a `multipart/x-mixed-replace` part until the next boundary arrives, so a page that was not repainting left the pane blank while the bridge held a good JPEG. The newest frame now repeats while a viewer is attached, which is the case the preview exists for: a run parked on a login wall is not changing on its own.
- 788e033: Say the browser protocol's two guidance lines in plain words. Both were written for the agent and read as jargon to everyone else, and users do read the system prompt: one told the agent to reach for the browser "when fetching the HTML would not answer the question", the other to prefer "one page and navigate it, rather than opening a new page per URL". Same two rules, said so a human gets them on the first pass.
- 2e46392: Announce the browser preview's port on the run's first `session` event instead of before it. The dashboard renders only the tail from the last `session` event, so the announcement was sliced out of the run's view and the `browser preview` line never appeared in the feed.
- 5904116: The Browser pane recovers from a failed stream instead of latching "not reachable" (#946)

  One img error (e.g. opening the tab before the run's stream endpoint was up) permanently swapped
  in the failure message until a remount. The failure is now keyed to the exact stream it happened
  on, so switching runs starts clean, and a Retry button re-requests the stream. The fix lives in
  the dashboard client, which ships bundled inside this package.

- e41b392: Drop the navbar `New session` button (#772). The button shipped alongside removing the navbar textarea, but the navbar's shape is still being decided, so it comes out until it lands with the rest of the redesign. The rail's Live row already starts a new session in the selected project, so nothing is lost meanwhile.
- 1589150: Add the tickets view (#697). The dashboard's right rail has a Tickets tab listing the project's `tickets/*.md`: title, TLDR, priority, and whether the agent has already spiked or planned it. A spike or a plan folds into the ticket it belongs to rather than appearing as a ticket of its own.

  Each row can be put on the agent queue with one click, which appends it to `TODO_AGENTS.md` directly rather than spending a session to write one line. An empty `tickets/` offers to import the repo's GitHub issues instead of being a dead end.

  Tickets written before the ticket format still list: a heading, a filename, or neither is enough to get a row.

- 7201a61: Call them sessions, not runs (#771). The user-facing vocabulary now matches claude.ai/code, so the dashboard, the CLI output and `--help` all say session: the Sessions rail, "Start a session", "Message the session to continue it", "Session started/finished" notifications, "a session is already active for this project", and the rest.

  Copy only. No identifier, type, RPC, CLI flag or on-disk name changed: `RunMeta`, `onRuns`, `--run-id`, `run.json` and `runs/` stay as they are, so nothing on anyone's disk moves and no API breaks. "Run" as a verb is left alone too ("run `framework --help`", "npm run dev", "dry run").

- f99424f: Replace the navbar textarea with a `New session` button (#772). The sticky top nav carried a second prompt editor next to the launcher's own, so the dashboard had two textareas competing for the same job. The navbar now holds the de-facto standard button instead: it lands on the selected project's launcher with a fresh Context, and that page's single textarea starts the session.
- 836b5c7: Replace the projects sidebar with a project dropdown in the top nav (#772). The left-most rail existed to answer one question, which project am I on, and it spent a full column on it while pushing the sessions rail, the main pane and the views rail into what was left. The selection is now a dropdown in the nav: it is shown on every page including the Overview, it keeps the "needs you" badge the rail carried, and `Add project` keeps its trust confirmation. The `New session` button also returns, now that the nav's shape is settled.
- 136ee9a: Give the room to a big view (#862). The right rail is where the agent's pushed views, its browser and its choice gates are read, and it was a fixed narrow column whatever it held. It now widens for those three, and the sessions rail shrinks to a strip of status dots for as long as they are shown. Hovering the strip, or tabbing into it, brings the sessions back over the main pane rather than pushing it aside, so nothing you are reading moves. A list-shaped tab (files, docs, log) returns both rails to their usual widths.
- bcb4299: Name the prompt disclosure "Enhanced System Prompt" and give it its two real switches (#863). The line under the prompt now says whether the enhancement is completely on (✅) or not (❌) without being expanded, and expanding it offers the two axes the prompt actually has: the anti-laziness and large-scope planning block, and the integration with The Framework. They write the same preferences the session-options gear does, so the two surfaces cannot disagree.

  The preview also covers the browser section now. It was left out, so a run with Browser on displayed less than it sent, and the point of showing the prompt is that it is the whole prompt.

- 7e77c58: Two small corrections.

  The ticket format now tells a plan to break itself into sub-plans when there is variability (#684), matching the spec.

  The usage panel no longer says the roadmap toggle needs half of every budget free. That rule was removed in #870, so the sentence had been describing behaviour that no longer existed.

- 314995f: Fix a spurious "await limit reached" notice after a live-chat run (#742). `runAwaitRounds` reported the opening prompt's await-round exhaustion even when a live-chat phase followed and the run actually ended because chat was stopped. `runChatPhase` now reports its own settled `exhausted`, and a run that ends on Stop/close after chat is no longer treated as having hit the await limit.
- 95e6d5a: Never render a timestamp as "Invalid Date" (#759). A project timestamp reaches the UI as a plain string (a LOGS.md heading carries its `at` verbatim), so a missing or unparseable one used to print literally. Every date the dashboard shows now formats through one helper that falls back to a dash, or to "no activity yet" in the Projects sidebar.
- 12b1653: Fix starting a second run navigating to the previous one (#761). The dashboard adopted the run it had just started by looking for "the run that is running", which was safe while a project could only have one. Since concurrent runs (#736) it is not: the previous run is still running, and the new one has not written its `run.json` yet, so the old run was the only match and the view parked on it.

  `sendStart` now returns the run id the daemon allocated, which it already knows because it names the run's worktree with it, and the dashboard selects that run instead of inferring one. A run with no worktree (the non-git fallback) reports no id and keeps the previous behaviour, which is still correct there because one run at a time still holds.

- a95f52c: Isolate the test suite from the machine's own daemon (#765). The tests read the global state at `$XDG_CONFIG_HOME`, so running them while a daemon was up wired the control watcher and its file follower kept the event loop alive, timing several cases out. The suite now runs against a throwaway config home, so a developer using the dashboard no longer gets false failures.
- ae9ecd6: Fix a newly started run showing the previous run's logs (#766). A run is resolved to its checkout by looking through the live run state, but for the first seconds of a run there is none: the daemon creates the worktree, spawns the process, and the run writes its `run.json` a beat later. The lookup missed a run that certainly existed and fell back to the project root, whose event log holds an older run's output.

  It stuck because a Telefunc Channel resolves its path once, when the client subscribes, so the feed tailed the wrong file for the life of the subscription rather than correcting a moment later.

  A run is now resolved by its worktree directory, which is named with the run id and exists before the process starts. A run id with no worktree still falls back to the project root, which stays correct for the non-git fallback path and for a run whose worktree has been removed.

- 6412128: Fix a continued run showing as finished (#768). Continuing a stopped run worked — the run went live again and the agent replied — but the dashboard kept rendering its finished replay, so it looked like nothing had happened.

  Every reader deduped a run present in both the live and archived lists by keeping the archived copy. That was right while a run was only ever archived on its way out, so the archive was the final word. A continued run (#762) has an archive from its first leg while being live again, and that archive shadowed the live copy, showing a running run as done.

  The live copy now wins, in the runs list, the activity feed and the project summaries.

- 50a548c: Fix a newly started run briefly showing the previous run's log (#774). On Start the shell followed live until the poll surfaced the new run's row, and during that window the feed subscribed with no run id, which resolves to the project root and its older output. The right log replaced it a moment later, so the run flashed the wrong content first.

  The shell already gets the run id back from Start, so the feed now subscribes to that run immediately and there is no window addressed at the project root. The same id drives the run's controls, so an immediate Stop or message also reaches the right run rather than the project.

- 9069628: Reject `--resume-session` on a run kind that cannot honor it (#782). Only the direct-prompt path resumes an agent conversation; a build run took the flag and dropped it, so the run started fresh and looked like it had continued while having silently lost the context. It now fails with a usage error instead.
- d2373cb: Never delete work a run left uncommitted (#786). Retiring a finished run removed its worktree with `git worktree remove --force`, so an edit the agent made but never committed was destroyed with the checkout, unrecoverably. Teardown now commits the run's pending work to its own branch first, which outlives the worktree, and keeps the checkout when that commit cannot be made.
- 726ed95: Make the run-options menu say only what the code delivers (#801).

  - **Autopilot** no longer claims it "also relaxes the maintenance stance". #556 moved that section out of the system prompt, so the choice-gate countdown is its whole effect. Stale comments in `cli.ts` and `run.ts` asserting it steers the prompt are corrected too.
  - **Eco > Auto maintenance** is gated on Post-merge cleanup. It trims the on-before-mergeable prompt, not the built-in one, so on its own it dropped nothing. The `--eco-auto-maintenance` CLI help said the same wrong thing and now points at the right prompt.
  - **Browser** is disabled with a reason off Claude Code. The browser is wired through Claude Code's MCP config and other drivers take no MCP servers, so the box was checkable and inert. The CLI already warned via `unguardedNotices`; the dashboard was silent. `collectRunOptions` now also stops sending `browser` for a non-Claude agent, so the disable is real rather than cosmetic.

  Also fixes an Eco sub-row bug found on the way: the sub-drops rendered a `disabledReason` but ignored `disabled`, so a gated one would have looked disabled and still written through on click.

- 7a9699c: Group a session's actions at the end of its action bar (#807). Serve, Stop, Remove and Open session sat at the start of the row, interleaved with the worktree chip, and since each one is conditional the row shifted under the cursor as a session moved through its life. What the session is now reads at the start of the bar; what you can do to it sits at the end, in one place.
- a7582e1: Per-project settings now actually save (#866). The daemon serves a prebuilt dashboard and so registers each telefunction by hand, and the two per-project preference ones were never added to that list. Every read and write of a project's own settings answered 400, the caller discarded the rejection, and the dashboard went on showing the value you picked, so a setting looked saved until the next reload threw it away. Per-project run options (#800) silently fell back to the global ones.

  A test now holds the registry against the telefunc modules' own exports, so a telefunction that is added but never registered fails the suite instead of failing in the daemon.

- 5b7b2c8: Auto PM now paces itself by your own usage limits (#870). It used to keep a second budget rule of its own, refusing unless half of every window was still free, so there were two sets of limits to reason about and the stricter one was invisible. It now runs while your configured limits are not met and stands down once one is, which is the same line autopilot already stops at.

  It still refuses to start anything when the quota cannot be read at all: an unreadable budget must never stop your own work, but it does stop work nobody asked for.

  The `DEFAULT_MIN_FREE_PERCENT` export and the `minFreePercent` override are gone with the rule.

- afcbfce: The project log survives a multi-line prompt (#897)

  `.the-framework/LOGS.md` is committed history, but a run's entry wrote the prompt straight
  into the entry's heading. A prompt spanning several lines spilled the rest of itself into the
  file as loose text, where reading the log dropped it; a prompt containing a line that looked
  like a heading forged a second entry, and one that looked like a status line rewrote the real
  one.

  A title and a prompt bullet are now escaped to a single line on write and unescaped on read,
  so a prompt round-trips whole whatever it contains. Logs written before this still read fine.

- c02f317: Fix Stop doing nothing, and headless runs never exiting (#905)

  A run decided whether it could be steered by asking whether _a daemon was alive on this machine_.
  That is not a fact about the run, and it was wrong in both directions.

  The daemon spawns every run with `--no-dashboard`, so that check was the only thing wiring their
  control channel. When the daemon's state file went missing while the daemon was still running (it
  deletes itself on a stale pid and is never rewritten, #922), spawned runs stopped watching the
  control channel: every Stop press was written to disk and read by nobody, with no error shown.

  The same check ran the other way too. A run typed into a terminal with `--no-dashboard` picked up a
  control channel just because a daemon existed somewhere, which handed it the live-chat queue, and
  it waited forever for a message that terminal could never send.

  Those are now two separate questions. A run is steerable when it has its own dashboard, when a
  daemon is live (unchanged, so a daemon still steers runs it did not start), or when whoever spawned
  it gave it a run id, which is what the daemon does and what holds when the state file does not. A
  run stays open for chat only when someone is actually waiting in it: its own dashboard, or the
  daemon started it. Stop and choice picks keep working either way.

- 135f210: A synchronously-failing gateway socket factory no longer kills the Discord bot permanently (#942)

  When the socket factory threw synchronously (e.g. a malformed URL), open() logged and returned:
  no socket exists, so no onClose ever fires and no reconnect is ever scheduled — zero loop instead
  of the backed-off one reopen() was designed for. The catch now falls through to the same backoff
  path a failed connection takes; stop() still cancels it.

- 8df2f95: Colour the mark while the AI is working (#875). The hexknot in the top bar, and the tab icon beside it, switch to the brand's animated colour variant for as long as any project has a session running, and back to the black & white mark when nothing does. Hovering the mark says which: "AI is working for you 🚀" or "AI isn't working for you 💤". The shared read-only relay view follows the one run it is watching.
- daef9a5: Stop a daemon boot from marking live runs as finished. The boot reconcile flipped every run meta still at `running` to `stopped`, on the assumption that a fresh daemon drives no in-flight run. That holds only while exactly one daemon ever boots, so a second one marked genuinely live runs as finished, giving them a no-op Stop in the dashboard. A meta whose recorded pid is alive on this host is now left alone; one that is provably gone, on another host, or from before the pid was recorded is reconciled as before.
- bf70326: New [Market research] preset (#694)

  Researches the market, writes it to `MARKET_RESEARCH.md`, and queues a follow-up that
  turns the findings into tickets. Researching and deciding what to build from the research
  are separate runs, so a human can read the findings before anything is proposed.

  `MARKET_RESEARCH.md` joins the context every run starts with, as a document the agent
  reads rather than one it folds knowledge back into at merge.

- 728d833: Give the chat log back its scrollbar styling (#914). Our port of shadcn's message-scroller dropped the styling upstream puts on its viewport, because those classes come from a Tailwind plugin we do not have. They are back as three small local utilities on plain `scrollbar-width` / `scrollbar-color` / `scrollbar-gutter`: the log's bar is toned like the rest of the app, its width is reserved so arriving output does not shift the text sideways, and it goes quiet while the log is chasing the live edge. The log's bottom edge now fades out while there is more below it, and the fade is gone at the live edge so the newest line is never dimmed.
- 9a3327b: Continue a finished session even when its agent conversation is gone (#778). Resuming passes the captured session id to the agent CLI, which refuses it once the conversation has left its history. The driver now retries that turn once without the resume flag, so the session continues as a fresh conversation and says so in the event log, instead of failing with the reason buried there.
- 513f3ba: Stop the dashboard growing a second, phantom scrollbar (#904). The document itself was scrollable next to the content pane's own scrollbar, and dragging it slid the whole app, header and all, off the top of the window. Visually-hidden labels are absolutely positioned, and with no positioned ancestor they escaped the workspace row's clipping and kept their place deep inside the scrolled content, which is what the browser measured the page against. Only the pane scrolls now.
- 698bc1f: Report what the post-merge cleanup step did (#835). It used to decline for five reasons, four of them silently, and say so on stdout in the one case that spoke up. A dashboard-started run is spawned with `stdio: 'ignore'`, so turning on Post-merge cleanup and getting nothing was indistinguishable from it having run. The outcome is now a real `on-before-mergeable` event (queued, incomplete, or skipped with the reason), and it fires before the run's event log is archived so it survives into the run's history.
- 181c7b5: PREFERENCE_KEYS is compiler-enforced complete against Preferences (#944)

  The boolean key list is now derived from a Record over the boolean keys of the Preferences type,
  so omitting a newly added boolean preference fails the build instead of making
  sanitizePreferences silently drop it on every save (write-then-vanish). No runtime behavior
  changes today; this closes the failure shape for every future preference.

- b214e85: Auto PM lands its queue in the checkout instead of re-doing the work forever (#852)

  A run works in its own git worktree, so the queue it wrote lived on a branch the
  sweep never reads. The checkout still looked empty, and every cooldown auto PM
  re-derived the same entries onto a new branch, spending real quota each time.

  The daemon now copies `TODO_AGENTS.md` from a finished run's branch into the
  project checkout, committing only that path. The agent never writes to the
  checkout, and a checkout with uncommitted queue edits is left alone.

- 92eec90: Point the prompting at `TODO_AGENTS.md`, the queue file the code actually promotes (#885)

  Both `${{ }}` blocks of the system prompt declared `TODO_FILE` as `TODO_<SESSION_NAME>.agent.md`,
  while the code had already moved to the flat `TODO_AGENTS.md`: that name is `FLAT_TODO_FILE`, the
  session-scoped one is `LEGACY_TODO_FILE`, and `promoteQueue` carries only the flat file off a run's
  branch.

  So an agent following the prompt wrote its backlog to a legacy name that nothing promotes, and an
  unattended run's queue never reached the checkout. The reader tolerates both names, which is why
  this stayed invisible.

  The two assertions that pinned the old name now derive it from `FLAT_TODO_FILE` instead of
  hardcoding a literal, so the prompt cannot silently desync from the code again.

- c17e550: Reply-mirror bindings are released once their run is gone (#941)

  Nothing ever unbound a chat-touched run, so every binding stayed in the map for the daemon's
  lifetime and each 3s poll scanned every project's live metas per bound run — IO that only ever
  grew. The daemon's conversation reader now answers `undefined` for a run with no live meta
  anywhere (archived, or its project removed), and after a few consecutive misses the mirror drops
  the binding and logs it. A transient miss (or a throwing read) still costs one poll, not the
  binding, and a fresh bind gets the same grace against the meta-not-yet-on-disk race.

- c7803cb: Give the rails and panels a scrollbar you can see (#913). The Sessions rail, the Docs / Tickets / Log panels, the agent's views and choices, and the Overview all scrolled behind the OS scrollbar, which on macOS hides itself: a rail full of sessions looked like a rail with nothing more in it. They now use shadcn's Base UI scroll area, themed from our own tokens, present for as long as the content overflows and darkening under the pointer. A panel whose content fits still shows no bar at all.
- 2fad888: An agent that names its session "view" is no longer silently ignored (#939)

  slugify's empty-slug fallback was the literal sentinel `view`, and parseSessionName rejected that
  sentinel, so a legitimate `View` in a set-session-name block was indistinguishable from no name
  and the rename was dropped. slugify now takes its fallback explicitly: parseSessionName tests for
  emptiness, and the `view` fallback stays local to the markdown-view ids where it belongs.

- bc5b90d: A malformed request can no longer kill the daemon, the relay, or a preview server (#938)

  Three request paths crashed the process on hostile-but-trivial input: `decodeURIComponent` on the
  raw path in the dashboard bundle server and the preview fallback server (`GET /%zz` became an
  unhandled rejection out of a void-dispatched handler), and `new URL(req.url, ...)` in the dashboard
  and relay request handlers (an absolute-form request target like `GET http://[ HTTP/1.1` throws
  synchronously; Node passes it through verbatim). The dashboard now treats a malformed escape as an
  unknown path (the SPA shell), the preview server and relay answer 400, an unparseable request
  target answers 400 everywhere, and a trailing-slash cwd no longer fails the preview server's
  path-prefix check.

- 24b900a: An agent CLI that exits before reading its prompt no longer crashes the daemon (#943)

  The shared CLI runner wrote the prompt to the child's stdin with no error listener. A CLI that
  dies before draining stdin (bad flag, instant crash) surfaces an async EPIPE on the stream, which
  with no listener is an uncaught exception in the daemon. The write error is now swallowed; the
  close handler already reports the failed turn with the CLI's own stderr.

- bcecc7b: Stop a status check from unregistering a running daemon. `daemonStatus()` deleted the state file whenever it named a process that was gone, and the daemon only ever wrote that file at startup, so one check against a stale pid left a live daemon invisible for the rest of its life: `framework stop` could not find it, and `framework --daemon` kept spawning a replacement that died on the already-bound port. The read now reports a stale record instead of deleting it, a running daemon re-asserts its record if it goes missing, and the record is written atomically so a torn read is never mistaken for a dead daemon.
- 30f41ee: Use the numeric priority scale in the TODO_AGENTS.md format spec (#880)

  The shipped spec described named tiers (URGENT / High / Medium / Low). The format was revised to
  a numeric 0-10 scale — 10 is act-immediately, 0 is only-if-capacity — so the spec now matches.

  Still no parser change: entries are read in file order and headings are skipped, so a
  priority-sorted file drains in priority order.

- 0f16b3e: Auto PM runs no longer hang on their first choice gate (#846)

  A daemon-spawned run parks each choice gate waiting for a human, and autopilot's
  auto-accept countdown runs in the browser — so a run started while nobody was
  watching waited forever. Runs the daemon starts on its own are now marked
  unattended and take the recommended option, the same fallback a headless run
  already uses. Stop is unaffected.

- 58786ca: Discord webhook posts are clamped to the 2000-char limit and failures are logged (#940)

  The notification posters (activity, needs-you interventions) sent whatever content they built and
  never looked at the response. Discord rejects a message over 2000 chars with a 400, so a long
  needs-you batch silently posted nothing. The shared webhook transport now clamps with the same
  helper the bot API uses, resolves whether Discord accepted the post, and the daemon logs a failed
  delivery like its other failures.

- Updated dependencies [6f7cf23]
- Updated dependencies [66c7aeb]
  - @gemstack/ai-autopilot@0.11.0

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
