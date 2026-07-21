# @gemstack/framework-dashboard

## 0.2.0

### Minor Changes

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

- 00e35a9: A toggle for the Discord chatbot (#916)

  The Discord chatbot (#680) is gated on a `discordBot` preference that had no UI, so turning it on
  meant hand-editing `~/.the-framework.json`. It now sits in the notifications popover.

  It gets its own "Chat" group rather than joining the delivery methods. Everything else in that menu
  posts outward; this one takes messages in and lets them start and steer sessions, which is worth
  keeping visually apart. For the same reason it stays off by default and does not light the bell,
  which is about notifications.

- 206fc61: New preset: Import tickets from GitHub, and it always opens a session of its own (#959)

  The triage and planning presets all read `tickets/`, so a repo with an empty one has nothing
  for them to work from. This fills it from the repo's GitHub issues.

  It is the first preset marked `newSession`. Loaded from inside a session, every other preset
  is a message to that session; this one is not about the conversation at all, and appending it
  would put the import on that session's branch, behind its context. So both in-session
  composers send it as a new run instead, and the view follows it.

- 45d22aa: Run options default per project instead of globally. They lived in one `Preferences` object shared by every registered project, so the model you picked for a TypeScript monorepo silently followed you into a scratch prototype. A project now stores only the options it overrides, in a `projectPreferences` block keyed by project id, and anything it does not set still falls through to the global object. Choosing an option while a project is open sets it for that project; the user-level ones (theme, editor, notifications, saved presets) and the consumption limits stay global, as does everything chosen from the Overview. Existing registries read and behave exactly as before until something is overridden.
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

### Patch Changes

- 726ed95: Make the run-options menu say only what the code delivers (#801).

  - **Autopilot** no longer claims it "also relaxes the maintenance stance". #556 moved that section out of the system prompt, so the choice-gate countdown is its whole effect. Stale comments in `cli.ts` and `run.ts` asserting it steers the prompt are corrected too.
  - **Eco > Auto maintenance** is gated on Post-merge cleanup. It trims the on-before-mergeable prompt, not the built-in one, so on its own it dropped nothing. The `--eco-auto-maintenance` CLI help said the same wrong thing and now points at the right prompt.
  - **Browser** is disabled with a reason off Claude Code. The browser is wired through Claude Code's MCP config and other drivers take no MCP servers, so the box was checkable and inert. The CLI already warned via `unguardedNotices`; the dashboard was silent. `collectRunOptions` now also stops sending `browser` for a non-Claude agent, so the disable is real rather than cosmetic.

  Also fixes an Eco sub-row bug found on the way: the sub-drops rendered a `disabledReason` but ignored `disabled`, so a gated one would have looked disabled and still written through on click.

- b5043cc: Scope the file tree to the active worktree (#815). The tree listed the project root and dotted it with the project root's git status, while the action bar directly above it resolved the session's worktree for the branch, Serve and open folder. Both reads already took a `runId` (#738); the tree now passes the selected one, and polls the file list so a file the session creates shows up.
- b7c8a89: Drop the agent/model select from the in-session composer (#831). A session is bound to the agent it started with: the driver is created once at spawn, and a follow-up message carries only text, so switching the select from Claude to Codex mid-session changed nothing but the _next_ session's default. Model and agent are now chosen at the launcher, the one place they take effect.

  Also fixes the quieter half of the same bug on a finished session: the resume composer read the global agent pref and sent it alongside the captured session id, so a Claude session id could be handed to `codex --resume`. A continuation now resumes on the agent the run actually ran under.

- Updated dependencies [38c8e80]
- Updated dependencies [4c89b8a]
- Updated dependencies [02619cc]
- Updated dependencies [296b559]
- Updated dependencies [ee78ce1]
- Updated dependencies [8857670]
- Updated dependencies [a0f5a64]
- Updated dependencies [0749c76]
- Updated dependencies [770591a]
- Updated dependencies [6ed8f90]
- Updated dependencies [788e033]
- Updated dependencies [2e46392]
- Updated dependencies [5904116]
- Updated dependencies [e41b392]
- Updated dependencies [aeb4f09]
- Updated dependencies [a2a35be]
- Updated dependencies [b5300a6]
- Updated dependencies [137aecd]
- Updated dependencies [3fc09a2]
- Updated dependencies [3c8a606]
- Updated dependencies [1589150]
- Updated dependencies [c7a0bde]
- Updated dependencies [5c2679b]
- Updated dependencies [1c97dcb]
- Updated dependencies [b6e6c82]
- Updated dependencies [312f993]
- Updated dependencies [0d15eb6]
- Updated dependencies [0d15eb6]
- Updated dependencies [504626d]
- Updated dependencies [7201a61]
- Updated dependencies [f99424f]
- Updated dependencies [836b5c7]
- Updated dependencies [6f2901f]
- Updated dependencies [e834f82]
- Updated dependencies [a42c0b7]
- Updated dependencies [c9e777e]
- Updated dependencies [c9e777e]
- Updated dependencies [5dfa1a1]
- Updated dependencies [b9128e0]
- Updated dependencies [773ca7d]
- Updated dependencies [7041dc4]
- Updated dependencies [cab77e9]
- Updated dependencies [8ecbac6]
- Updated dependencies [867e66f]
- Updated dependencies [a64c29a]
- Updated dependencies [4e32eba]
- Updated dependencies [136ee9a]
- Updated dependencies [bcb4299]
- Updated dependencies [8dc742f]
- Updated dependencies [b05663f]
- Updated dependencies [7e77c58]
- Updated dependencies [314995f]
- Updated dependencies [95e6d5a]
- Updated dependencies [12b1653]
- Updated dependencies [a95f52c]
- Updated dependencies [ae9ecd6]
- Updated dependencies [6412128]
- Updated dependencies [50a548c]
- Updated dependencies [9069628]
- Updated dependencies [d2373cb]
- Updated dependencies [726ed95]
- Updated dependencies [7a9699c]
- Updated dependencies [a7582e1]
- Updated dependencies [5b7b2c8]
- Updated dependencies [afcbfce]
- Updated dependencies [c02f317]
- Updated dependencies [135f210]
- Updated dependencies [206fc61]
- Updated dependencies [e5e662a]
- Updated dependencies [8df2f95]
- Updated dependencies [daef9a5]
- Updated dependencies [bf35985]
- Updated dependencies [bf70326]
- Updated dependencies [728d833]
- Updated dependencies [862ed73]
- Updated dependencies [500bec7]
- Updated dependencies [1e3647b]
- Updated dependencies [9a3327b]
- Updated dependencies [45d22aa]
- Updated dependencies [513f3ba]
- Updated dependencies [698bc1f]
- Updated dependencies [181c7b5]
- Updated dependencies [d3d470e]
- Updated dependencies [b214e85]
- Updated dependencies [92eec90]
- Updated dependencies [ff5792c]
- Updated dependencies [e8dab8e]
- Updated dependencies [c17e550]
- Updated dependencies [c7803cb]
- Updated dependencies [2fad888]
- Updated dependencies [bc5b90d]
- Updated dependencies [24b900a]
- Updated dependencies [7fced75]
- Updated dependencies [eff5f40]
- Updated dependencies [bcecc7b]
- Updated dependencies [30f41ee]
- Updated dependencies [e62b60d]
- Updated dependencies [b4dce07]
- Updated dependencies [0f16b3e]
- Updated dependencies [a47d2d9]
- Updated dependencies [58786ca]
  - @gemstack/framework@1.0.0

## 0.1.0

### Minor Changes

- 3302b0f: Add the usage panel: what the account has left (the agent's own quota windows) and how much of it The Framework may spend before it pauses itself (the three consumption limits, each with a checkbox and a bar). Replaces the dashboard's "Usage & credits" placeholder.

### Patch Changes

- c871fb2: Stop dropping failed dashboard reads. Every panel wrote its own async effect and only the usage panel caught, so a daemon restart made each of the others an unhandled rejection every tick. They now share two hooks (`useLoaded`/`usePolled`) that keep the last value through a failed read, reset on a project switch rather than showing the previous project's data, and retire an in-flight read on unmount — including the Runs rail's `reload`, which was unguarded and could write a stale project's runs.
- dac7613: Rename the "post-merge" prompt to "on-before-mergeable" (#592). It fires on `setReadyForMerge()`, before the merge, so "post-merge" was a misnomer (Rom's call in #559). Renamed end to end: the `--post-merge` flag is now `--on-before-mergeable`; `runPostMerge` / `renderPostMergePrompt` / `PostMergeContext` / `POST_MERGE_PROMPT` become their `OnBeforeMergeable` equivalents; the prompt file is `on_before_mergeable_prompt.md`; and the dashboard preference key `postMergeQuality` is now `onBeforeMergeableQuality` (a saved toggle resets to its default once). No agent-facing prompt text changed: the string "post-merge" never appeared in any prompt. The dashboard's visible "Post-merge cleanup" label is left as-is pending a copy decision.
- Updated dependencies [68555e4]
- Updated dependencies [ca2b719]
- Updated dependencies [0faa297]
- Updated dependencies [e65e16a]
- Updated dependencies [0c922a6]
- Updated dependencies [5844526]
- Updated dependencies [aac6e5d]
- Updated dependencies [6721c0f]
- Updated dependencies [8c576df]
- Updated dependencies [be0a58c]
- Updated dependencies [4788a22]
- Updated dependencies [9e71fc8]
- Updated dependencies [b22337a]
- Updated dependencies [558bdb8]
- Updated dependencies [7a94b48]
- Updated dependencies [016fb8d]
- Updated dependencies [112c3a6]
- Updated dependencies [aac6e5d]
- Updated dependencies [87d67c8]
- Updated dependencies [76c1bfa]
- Updated dependencies [6524e0a]
- Updated dependencies [d0fe851]
- Updated dependencies [9a27125]
- Updated dependencies [cdfe508]
- Updated dependencies [e808793]
- Updated dependencies [d4fe2e5]
- Updated dependencies [f61a367]
- Updated dependencies [5646b16]
- Updated dependencies [65e27fd]
- Updated dependencies [06cb0ce]
- Updated dependencies [7ca71be]
- Updated dependencies [e0404cf]
- Updated dependencies [1dbc02a]
- Updated dependencies [dcea89b]
- Updated dependencies [f82e220]
- Updated dependencies [18de94b]
- Updated dependencies [27f522a]
- Updated dependencies [900efbb]
- Updated dependencies [4ed510f]
- Updated dependencies [a345a83]
- Updated dependencies [63b2a73]
- Updated dependencies [1bb66cf]
- Updated dependencies [48aba07]
- Updated dependencies [3091bc2]
- Updated dependencies [44988d7]
- Updated dependencies [dabdf0f]
- Updated dependencies [c26159d]
- Updated dependencies [16e86c4]
- Updated dependencies [43d4f50]
- Updated dependencies [90c15bf]
- Updated dependencies [388f3ad]
- Updated dependencies [48f25cd]
- Updated dependencies [4e43d76]
- Updated dependencies [72fb351]
- Updated dependencies [ed25ab8]
- Updated dependencies [f9add6d]
- Updated dependencies [e4b38b3]
- Updated dependencies [131f349]
- Updated dependencies [f1ff0d2]
- Updated dependencies [4a741f6]
- Updated dependencies [affa3d8]
- Updated dependencies [c05a186]
- Updated dependencies [1f588aa]
- Updated dependencies [5882932]
- Updated dependencies [eec009d]
- Updated dependencies [5d54b64]
- Updated dependencies [99229db]
- Updated dependencies [ee075ec]
- Updated dependencies [1f6a0d3]
- Updated dependencies [06fefbe]
- Updated dependencies [c584b16]
- Updated dependencies [b183dc0]
- Updated dependencies [aa5870e]
- Updated dependencies [28fff61]
- Updated dependencies [4aaa00a]
- Updated dependencies [f0a024c]
- Updated dependencies [4746188]
- Updated dependencies [f496a54]
- Updated dependencies [e370b41]
- Updated dependencies [79af200]
- Updated dependencies [164771a]
- Updated dependencies [4d456c2]
- Updated dependencies [c06532e]
- Updated dependencies [43bae91]
- Updated dependencies [f50f0d5]
- Updated dependencies [a743cd4]
- Updated dependencies [72533fc]
- Updated dependencies [7e1ea76]
- Updated dependencies [5709703]
- Updated dependencies [21fe373]
- Updated dependencies [89cedff]
- Updated dependencies [cfdbd59]
- Updated dependencies [5bd0489]
- Updated dependencies [721f539]
- Updated dependencies [db95caa]
- Updated dependencies [d1331a2]
- Updated dependencies [d834af8]
- Updated dependencies [c4a992a]
- Updated dependencies [b7de2a1]
- Updated dependencies [3f12815]
- Updated dependencies [4067614]
- Updated dependencies [5108aea]
- Updated dependencies [32e9d3e]
- Updated dependencies [c48af6d]
- Updated dependencies [96870d2]
- Updated dependencies [9d1951b]
- Updated dependencies [5d1653b]
- Updated dependencies [d10d515]
- Updated dependencies [18c9352]
- Updated dependencies [cbe1898]
- Updated dependencies [68d0df4]
- Updated dependencies [f736b55]
- Updated dependencies [1f1a2a3]
- Updated dependencies [1e1b4dc]
- Updated dependencies [28c3330]
- Updated dependencies [632f0df]
- Updated dependencies [734da1a]
- Updated dependencies [9442761]
- Updated dependencies [2a12ec8]
- Updated dependencies [eb1a0f1]
- Updated dependencies [5e24797]
- Updated dependencies [dac7613]
- Updated dependencies [7f9c514]
- Updated dependencies [98f44e2]
- Updated dependencies [aafbb55]
- Updated dependencies [4a70c5a]
- Updated dependencies [43d7fa0]
- Updated dependencies [b8c45a7]
- Updated dependencies [a76ace7]
- Updated dependencies [4d4d77c]
- Updated dependencies [68d53ff]
- Updated dependencies [8910ed3]
- Updated dependencies [03ca1b0]
- Updated dependencies [34d3ec2]
- Updated dependencies [c762529]
- Updated dependencies [c72d155]
- Updated dependencies [c6d005f]
- Updated dependencies [2fc612a]
- Updated dependencies [5c83bc2]
- Updated dependencies [9345476]
- Updated dependencies [59e3707]
- Updated dependencies [6b561fc]
- Updated dependencies [883d974]
- Updated dependencies [83e6a1f]
- Updated dependencies [5dcd8a4]
- Updated dependencies [3bd0478]
- Updated dependencies [d1202dc]
- Updated dependencies [e453bba]
- Updated dependencies [437618f]
- Updated dependencies [e4b518a]
- Updated dependencies [caf8a0b]
- Updated dependencies [bc3586b]
- Updated dependencies [7db5a9c]
- Updated dependencies [3302b0f]
- Updated dependencies [5417558]
- Updated dependencies [8d396f7]
  - @gemstack/framework@0.9.0
