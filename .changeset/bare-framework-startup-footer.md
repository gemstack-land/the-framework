---
"@gemstack/the-framework": minor
---

Print the commands and the version on bare `framework` too (#312).

#312 describes what `$ framework` should do, and two of its items were already built: the convenience command list and the version footer with the npm "up to date" check. Both lived only in `ensureDaemonCmd`, the `framework --daemon` path. Bare `framework`, the command the issue is actually about, foregrounds the dashboard instead and printed two lines: the URL and "Ctrl+C to stop".

Both paths now print one shared footer, so the version you are running is visible from the command people actually type, and so is a newer release when there is one.

The update line is not awaited before the static lines. #312 asks for the static info first, and the foreground path blocks on the server until it is signalled, so anything held back until after the registry call would never have been printed there at all. The check keeps its existing 2.5s cap and stays silent when npm is unreachable.

The foreground footer drops the `framework stop` line, which stops a detached dashboard; that path tells you Ctrl+C instead.
