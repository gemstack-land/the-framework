---
'@gemstack/framework': patch
---

An agent CLI that exits before reading its prompt no longer crashes the daemon (#943)

The shared CLI runner wrote the prompt to the child's stdin with no error listener. A CLI that
dies before draining stdin (bad flag, instant crash) surfaces an async EPIPE on the stream, which
with no listener is an uncaught exception in the daemon. The write error is now swallowed; the
close handler already reports the failed turn with the CLI's own stderr.
