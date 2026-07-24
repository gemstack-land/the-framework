---
"@gemstack/the-framework": minor
---

Dashboard: remove the top navbar and move its chrome into the sidebar (brand, a prominent Overview, an expandable Projects nav, and the Local/theme/notifications/Settings controls in a footer). Add a `project / session` breadcrumb and an always-available session-details disclosure (agent + spend) to the session toolbar, and fold the toolbar's actions (GitHub, folder, editor, Serve, Stop, Remove worktree, Delete, Open session) into a single overflow menu. Polish the Recents rail: themed scrollbar, a sticky label with a scroll-driven fade, lighter weights, and a hover marquee for long titles. Stop the toolbar flickering on session navigation (keep-previous on the git status / GitHub reads). Add an opt-in `pnpm dev:daemon` so the dev server can start runs by proxying to the daemon.
