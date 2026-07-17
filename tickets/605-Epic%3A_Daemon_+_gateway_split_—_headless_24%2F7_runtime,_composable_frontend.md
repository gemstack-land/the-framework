# Epic: Daemon + gateway split — headless 24/7 runtime, composable frontend

> Tracked-but-later (**Phase 1**). Do not build before the MVP ships. Direction captured from team discussion so it is not lost; not scheduled work yet.

## Vision

Split the runtime into composable pieces so The Framework can run anywhere from a single local machine to a hosted service:

- **Daemon**: a separately deployable service that runs 24/7, hosts the workspace, and gives agents shell + filesystem access and the local coding-agent CLIs (Claude Code, Codex) so it uses existing subscriptions rather than API-key pricing.
- **Gateway**: a public forwarding layer (Telefunc server) that joins agents and users into rooms.
- **Frontend**: the dashboard is just "a" frontend that connects to the daemon. Slack/Discord are other frontends.

## Decided direction

- Composable from the start: daemon + gateway + frontend as separate seams.
- Git-as-data: persist everything through Git repo(s), so no database and no real server are needed for local use. It can run 100% local as a desktop app, which underpins the "100% open source / free / local" positioning.
- Current state, for reference: all background jobs run in the same process as the frontend server today (so `Ctrl + C` after `framework` terminates everything). The headless split is the future direction, not a regression to fix now.

## Open questions

- The 24/7 responsibility: exactly one instance must manage the AI chat bot. Options discussed: a paid hosted daemon, a user-run VPS, or a simple lead-designation where one dev-machine instance auto-designates itself as the manager.
- Where the headless-browser preview runs (most likely on the daemon).

## Related

- #298 (background jobs) and its usage-limit management: the daemon is where these run continuously.
- #297 (bootstrap mode), #453 (git worktrees), #454 (syncing UI <-> data): all assume a runtime that can host long-lived, multi-repo work.

---
Source: https://github.com/gemstack-land/gemstack/issues/605
