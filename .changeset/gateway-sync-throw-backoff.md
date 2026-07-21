---
'@gemstack/framework': patch
---

A synchronously-failing gateway socket factory no longer kills the Discord bot permanently (#942)

When the socket factory threw synchronously (e.g. a malformed URL), open() logged and returned:
no socket exists, so no onClose ever fires and no reconnect is ever scheduled — zero loop instead
of the backed-off one reopen() was designed for. The catch now falls through to the same backoff
path a failed connection takes; stop() still cancels it.
