---
"@gemstack/framework": minor
---

Serve action: pick a server in a multi-package repo (#651). The dashboard's Serve button previously ran the first `dev`/`start`/`preview`/`serve` script from the repo root, which serves nothing (or the wrong thing) in a monorepo where the apps live in workspace packages. It now lists the servable apps across the repo, the root plus each workspace package that has a serve script (resolved from `pnpm-workspace.yaml` or the package.json `workspaces` field), and offers a picker when there is more than one. The daemon remembers the last pick per project so re-serving is one click. A single-app repo is unchanged.
