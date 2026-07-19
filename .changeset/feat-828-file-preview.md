---
'@gemstack/framework-dashboard': minor
'@gemstack/framework': minor
---

Hover an unchanged file in the tree to preview its contents (#828). The hover card taught on changed files now works on every row: a changed file shows its diff, an unchanged one shows its numbered contents. Adds `onFileContent`, sharing the path guard and checkout resolution of `onFileDiff`, and picking the read from the status the tree already holds rather than a second server lookup.

Also closes a real hole in that guard: the containment check compared the `resolve`d path, which does not follow symlinks, so a link inside the repo pointing outside it passed a textual check while the read left the checkout. Both reads now confine with `realpath`.
