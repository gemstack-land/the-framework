---
'@gemstack/framework': patch
---

A malformed percent-encoded request no longer kills the daemon or a preview server (#938)

Both static-file paths (the dashboard bundle server and the preview fallback server) called
`decodeURIComponent` on the raw request path inside a void-dispatched async handler, so a single
`GET /%zz` became an unhandled rejection that took the whole process down. The dashboard now
treats a malformed escape as an unknown path (the SPA shell), the preview server answers 400, and
a trailing-slash cwd no longer fails the preview server's path-prefix check.
