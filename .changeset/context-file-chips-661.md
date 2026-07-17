---
'@gemstack/framework': patch
---

Show the files picked into a run's Context as removable chips (#661). Files added via a `#` mention or the right-rail file tree were counted ("Context · 1 selected") but never shown, so clearing the prompt left them selected with no way to see or remove them. They now appear as chips under the run controls, each with an X that removes the file (which also unticks it in the file tree, since they share one context set).
