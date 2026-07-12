---
"@gemstack/framework": minor
---

The new Vike + Telefunc dashboard (#405) is now what the daemon serves by default at `/`; the legacy `page.ts` dashboard moves to `/legacy`. Set `FRAMEWORK_DASHBOARD=legacy` to keep `page.ts` at `/` (the escape hatch), and if a build ever ships without the prerendered bundle the daemon falls back to `page.ts` automatically. The `release` flow now runs `bundle:dashboard` so the published package ships the dashboard assets.
