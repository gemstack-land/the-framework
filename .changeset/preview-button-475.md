---
"@gemstack/framework": minor
---

Add a dashboard **Preview** button (#475): serve a project's built result on demand, decoupled from an agent run. One click runs the project's dev script (`dev`/`start`/`preview`/`serve`) and surfaces the live localhost URL it announces, with a **Stop** to tear it down; a project with a plain `index.html` and no dev script is served by a built-in static server instead. The preview lives in the daemon (one per project, idempotent to open) and is torn down on daemon shutdown; the button rehydrates after a reload. Exposed as three Telefunc RPCs (`sendPreview` / `sendStopPreview` / `onPreviewStatus`) and the `startPreview` helper.
