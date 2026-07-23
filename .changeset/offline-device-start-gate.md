---
"@gemstack/framework-dashboard": minor
---

Block Start when the selected "Run on" device is offline. When the run target is a saved device whose live status (from #1072) is offline, the submit button is disabled and a note asks you to pick another target in the "Run on" gear. Pressing Start no longer silently attempts the slow relay, and the target is never switched automatically (#1073). An unknown or still-checking status does not block.
