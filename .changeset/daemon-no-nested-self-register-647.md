---
'@gemstack/framework': patch
---

Stop the daemon from registering its own cwd as a duplicate project. When the daemon runs from a subfolder of an already-tracked repo (e.g. the package dir the binary lives in), it created `.the-framework/` for its own state and then re-added that subfolder as a nested project on every boot. `registerHomeProject` now skips a cwd that lives inside an already-registered project.
