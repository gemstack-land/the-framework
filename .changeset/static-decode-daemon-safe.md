---
'@gemstack/framework': patch
---

A malformed request can no longer kill the daemon, the relay, or a preview server (#938)

Three request paths crashed the process on hostile-but-trivial input: `decodeURIComponent` on the
raw path in the dashboard bundle server and the preview fallback server (`GET /%zz` became an
unhandled rejection out of a void-dispatched handler), and `new URL(req.url, ...)` in the dashboard
and relay request handlers (an absolute-form request target like `GET http://[ HTTP/1.1` throws
synchronously; Node passes it through verbatim). The dashboard now treats a malformed escape as an
unknown path (the SPA shell), the preview server and relay answer 400, an unparseable request
target answers 400 everywhere, and a trailing-slash cwd no longer fails the preview server's
path-prefix check.
