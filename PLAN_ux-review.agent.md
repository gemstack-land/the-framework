# UX review — findings & proposals (`ux-review`)

Full usability review of `packages/framework-dashboard` (every component + the UX-relevant read models). Each finding has a stable reference `U<n>` for follow-up conversations, an effort tag (S = small, M = medium), and a proposal. The recent #690/#691 paper-cuts batch was checked so nothing here duplicates it.

## A. Navigation & orientation

- **U1 · URL routing & deep links (M)** — Selection is in-memory only (`pages/index/+Page.tsx`): refresh loses the selected *run* (project survives via localStorage), browser Back exits the app, and you can't bookmark/share "this project, this run". Proposal: reflect `?project=…&run=…` in the URL, restore on load, wire popstate so Back/Forward navigate.
- **U2 · Notification click doesn't take you there (S)** — A "needs you" browser notification for a paused run only does `window.focus()` (`lib/use-intervention-notifications.ts:31`); you land wherever you were. Proposal: pass a navigate callback so the click selects the project (composes with U1).
- **U3 · Static tab title (S)** — `title: 'The Framework'` never changes. With several projects/tabs you can't see which needs attention. Proposal: dynamic `document.title` — needs-you count + selected project, e.g. `(2) gemstack — The Framework`.
- **U4 · Brand isn't a home button (S)** — Clicking "The Framework" in the header does nothing; standard affordance is "logo → Overview". The `dashboard` badge next to it carries no information. Proposal: make the brand a button to the Overview, drop the badge.
- **U5 · "Live" naming collision (S)** — The permanent launcher row in the Runs rail is labeled **Live** with a primary dot (`RunHistory.tsx:63`), while an actually-live run sits right below it with a pulsing dot + RUNNING badge. Proposal: rename the launcher row (e.g. **Home**, house icon); reserve "live" for running runs.
- **U6 · Small-window layout (M)** — Fixed rails (256 + 240 + 320 px) leave a sliver of main pane on half-screen windows; nothing collapses. Proposal: collapsible Projects/Runs rails (persisted), sensible behavior under ~1100px.

## B. Overview

- **U7 · Stat tiles aren't actionable (S)** — "Active runs 2 / Open TODOs 12" are dead ends. Proposal: clicking a tile scrolls to its section (Working now / Backlog / Projects).
- **U8 · Usage invisible inside a project (M)** — The Usage panel (quota + pause limits) only exists at the bottom of Overview; while working in a project you can't see you're about to hit a limit. Proposal: compact quota pill in the header (e.g. `5h 62%`), click → Overview usage.
- **U9 · Pause-limit thresholds not editable (S)** — `UsagePanel` shows "Daily 40%" etc. but the percent can only be toggled on/off, never changed, though preferences store `{percent, enabled}`. Proposal: small number input per limit row.
- **U10 · Overview loads as bare "Loading…" (S)** — Proposal: skeleton tiles/cards to avoid the layout jump.

## C. Start-run flow

- **U11 · Preset silently overwrites your prompt (S)** — Picking a preset (menu or `/` command) replaces the editor content with no warning (`PromptEditor.applyTemplate` → `setContent`). Typed work is lost. Proposal: confirm before replacing a non-empty editor.
- **U12 · Active-run conflict surfaced only after submit (M)** — The form always lets you compose + Start; with a run active the daemon rejects with "A run is already active." after the fact. The shell already knows (`runs`). Proposal: banner on the form ("A run is active — view it · stop it"), Start disabled with reason.
- **U13 · ⌘/Ctrl+Enter is undiscoverable (S)** — The editor submits on Cmd/Ctrl+Enter but nothing says so. Proposal: hint on the Start button (`title` + small ⌘↵ kbd) and/or in the placeholder.
- **U14 · Preset deletion is instant & irreversible (S)** — The X in the Presets menu deletes a saved preset on one (mis)click. Proposal: confirm step (click turns into "Delete?") or an undo note.

## D. Run monitoring

- **U15 · Timestamp chaos (S)** — `toLocaleString()` walls in the sidebar and Runs rail, date-only in the Projects table. Proposal: one `timeAgo()` convention ("2m ago", "yesterday") with the absolute time on hover, applied everywhere.
- **U16 · Run rows lack duration & session name (S)** — `RunMeta` already has `startedAt`/`updatedAt`/`sessionName`; rows show only status + start + intent. Proposal: show duration ("· 12m") and the session name when present.
- **U17 · Run views have no header (M)** — A finished run's replay is a bare event list — no status, when, how long, agent, session link; a live run shows no elapsed time. Proposal: compact run header (status badge · started · duration/elapsed · agent · session link) for both RunLive and RunReplay, from the meta the shell already holds.
- **U18 · Events carry no timestamps (M, cross-package)** — `events.jsonl` lines are written without `at` (`run-store.ts:278`), so the log can never show times. Proposal: additive envelope timestamp framework-side + show `HH:MM:SS` in `EventList` (old lines render without).
- **U19 · Auto-scroll yanks you down (S)** — `EventList` scrolls to bottom on every event even when you've scrolled up to read (`EventList.tsx:24`). Proposal: stick only when already near the bottom; otherwise show a "Jump to latest ↓" chip.
- **U20 · Stale "building…" after a run ends (S)** — `runProgress` never resets on `end`, so the project home keeps an amber pulsing "building…" pill after the run finished (until a new run truncates the stream). Proposal: use `isRunActive`; show the final state or hide the pill.
- **U21 · Event log has no noise filter (M)** — Long runs are a wall of `driver` lines. Proposal: kind filter chips (framework / agent / driver) above the log.

## E. Right rail & choice gates

- **U22 · Rail yanks the tab you picked (S)** — The auto-switch effect (`RightRail.tsx:45`) refires on any `hasChoices/hasViews/hasFiles` flip: open Docs → a view arrives → you're moved; the last choice resolves → moved again. Proposal: auto-switch only for *new* choices (and the first view); never override an explicit manual pick otherwise — badges already signal the rest.
- **U23 · Rail too narrow to read plans, not resizable (M)** — Plans/writeups (`showMarkdown`) and choice gates render in a fixed 320 px column. Reviewing a plan there is painful. Proposal: drag-to-resize with persisted width (min ~280 / max ~50%), possibly a quick "wide" toggle.
- **U24 · New agent view arrives silently (S)** — `ViewsRail` keeps `active` where it was; a freshly pushed view is just a chip you must notice. Proposal: auto-select the newest view unless the user explicitly picked another.
- **U25 · File filter hides its own matches (S)** — Filtering the Files tree narrows the list, but folders stay collapsed, so matches are invisible until each folder is opened by hand (`FileTree` passes no `open` to the accordion). Proposal: while a query is active, auto-expand the folders on the match paths.
- **U26 · Files tab purpose is unexplained (S)** — Clicking a file toggles run Context with only an icon swap; nothing says that's what the tab is for. Proposal: one hint line under the filter ("Click a file to add it to the run's context").
- **U27 · Multi-select gates lack bulk actions (S)** — A long checklist (like this one!) must be ticked box by box. Proposal: `All · None · Defaults` quick actions on multi gates with ≥5 options.

## F. Resilience & trust

- **U28 · Silent death when the daemon goes away (M)** — Failed polls keep the last value (by design) and the events channel dies without resubscribe — the dashboard becomes a frozen snapshot with no warning. Proposal: connectivity watchdog (poll failures / channel close) → unobtrusive "Daemon unreachable — reconnecting…" banner + auto-resubscribe of the event stream.
- **U29 · Light→dark flash on load (S)** — `.dark` is added in a React effect (`LayoutDefault.tsx:8`), so every load flashes the light theme first. Proposal: inline head script that sets the class before paint.
- **U30 · No theme choice (S/M)** — Light tokens exist but are unreachable; dark is forced. Proposal: system/light/dark preference (header menu), honoring `prefers-color-scheme`.
- **U31 · Serve URL hidden behind an icon (S)** — Once serving, the URL lives only in a tooltip; proposal: show `localhost:PORT` as clickable text next to the controls.
- **U32 · Notification setup is unverifiable (S)** — No way to test the pipeline; Discord hint names `DISCORD_WEBHOOK` with no pointer. Proposal: "Send test notification" item + a short how-to link/hint.

## G. Accessibility & polish

- **U33 · Status dots rely on color + hover only (S)** — Several status dots (sidebar activated, Working now, Projects table) have only a `title`; screen readers get nothing, and title needs a hover. Proposal: `aria-hidden` on decorative dots + sr-only text (or visible text) alternatives, consistently.

## Recommended set

Checked by default in the selection: U1–U5, U9, U11–U17, U19, U20, U22–U29, U31, U33 (high value, low risk). Left unchecked: U6, U7, U8, U10, U18, U21, U30, U32 (heavier, more opinionated, or cross-package).

After selection: accepted items become `TODO_ux-review.agent.md`, implemented in that order; items with real design alternatives (e.g. U5 naming, U8 placement) get an alternatives round per the framework protocol before code.
