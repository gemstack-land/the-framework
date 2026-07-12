---
"@gemstack/framework": minor
---

Serve the new Vike + Telefunc dashboard from the run relay (`--share`), in a read-only watch mode. The relay now serves the prerendered SPA and streams events over the same Telefunc `onEvents` Channel the daemon uses, sourced from its in-memory run instead of a file. Only the live event stream is exposed (an empty projects provider neutralizes the file/registry RPCs on the public host, and no run can be started or steered). The shareable viewer URL moves from `/r/:id/` to `/?run=:id` (old links redirect); ingest stays at `/r/:id/publish`. This removes the relay's dependency on the legacy `page.ts`. Adds `makeTelefuncMount`, `serveClientBundle`, `emptyProjectsProvider`, and the `EventsSource` type to the public surface.
