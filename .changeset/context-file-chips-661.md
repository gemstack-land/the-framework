---
'@gemstack/framework': patch
---

Show the files picked into a run's Context (#661). Files added via a `#` mention or the right-rail file tree were counted ("Context · 1 selected") but never shown, so clearing the prompt left them selected with no way to see or remove them. They now appear inside the Context section, listed like the repo rows but with an X to remove (which also unticks the file in the tree, since they share one context set). The Context section's contents get the same bordered box as the prompt disclosure, and that disclosure is renamed to just "Actual prompt".
