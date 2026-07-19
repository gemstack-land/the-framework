---
"@gemstack/framework": patch
---

Isolate the test suite from the machine's own daemon (#765). The tests read the global state at `$XDG_CONFIG_HOME`, so running them while a daemon was up wired the control watcher and its file follower kept the event loop alive, timing several cases out. The suite now runs against a throwaway config home, so a developer using the dashboard no longer gets false failures.
