---
'@gemstack/framework': minor
---

Keep the generated app running after a successful `--serve` run and surface a live preview link. Once the boot-and-serve gate passes, the app is booted once more and left serving; the dashboard shows an "open your app" banner and the terminal prints the URL, both live until you stop the run (Ctrl+C tears the app down). `runFramework` now returns an optional `preview` handle (`{ url, command, stop() }`) so callers own the app's lifecycle.
