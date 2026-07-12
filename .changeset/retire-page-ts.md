---
'@gemstack/framework': minor
---

Retire the legacy `page.ts` dashboard and its HTTP routes (#426, part 3). Both consumers are now on the new Vike + Telefunc dashboard (the daemon default, per-run/resume, and the relay), so `startDashboard` now serves only the prerendered SPA plus the `/_telefunc` mount (RPCs + the live-event Channel). Removed: the `dashboardHtml` and `parseStartOptions` exports, the in-process `Dashboard.push`/`Dashboard.stream` (the SPA reads `events.jsonl` over the Channel and steers over `control.jsonl`), and the now-unused `DashboardOptions` fields (`onStop`, `onChoice`, `cwd`, `dashboardMode`) and the `FRAMEWORK_DASHBOARD=legacy` escape hatch. A `--no-persist` foreground run (or an install missing the built bundle) now runs headless rather than falling back to the old page.
