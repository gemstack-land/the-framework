---
"@gemstack/framework": minor
---

Add the install-core module: `installProject(cwd)` activates a repo for The Framework by creating the `.the-framework/` marker with a seeded `LOGS.md`, committing any pre-existing dirty changes first (`[The Framework] uncommitted changes`) so the install commit (`[The Framework] install The Framework`) is clean; an already-activated repo is a no-op. Also `enumerateGitRepos(dir)` lists the immediate child directories that are their own git repo roots (for the "add a directory of repos" flow). Pure core over the existing `GitRunner` + `StoreFs` seams; any git failure surfaces as a value, never a throw. No daemon or UI wiring yet.
