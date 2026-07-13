---
"@gemstack/framework": minor
---

Bare `framework` now runs the dashboard server in the foreground (#456): Ctrl+C stops it, and the server's logs and any errors it throws are visible in the terminal. `framework --daemon` does what bare `framework` used to do, running the dashboard in the background (detached) and returning after printing the convenience commands. If a background daemon is already running, bare `framework` reports its URL and defers instead of fighting for the port.
