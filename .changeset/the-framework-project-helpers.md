---
'@gemstack/framework': minor
---

Add project repo helpers (#380): `isActivated()` checks the `.the-framework/` activation marker via an injectable `ProjectFs`, and `crawlRepoFiles()` lists every tracked + untracked (gitignore-honoring) file via `git ls-files -z` behind an injectable `GitRunner`. Both forgiving: any failure reads as not-activated / an empty list. Building blocks for the #314 sidebars.
