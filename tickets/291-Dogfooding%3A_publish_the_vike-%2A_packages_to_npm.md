# Dogfooding: publish the vike-* packages to npm

Part of #286 (dogfooding). This is gap 3 from the analysis, and it turns out to be a concrete publish task, not an open design question.

Why `--compose-extensions` only works inside the vike-data workspace: the built-in composers (framework-auth/data/rbac/crud/shell) just frame the agent to build on the vike-* packages. But those packages are all `"private": true` and not on npm, so a generated app can only install them via workspace linking. Outside the monorepo the framework falls back to hand-rolled auth + Prisma.

Confirmed private + unpublished (in the vike-data repo): vike-auth, vike-rbac, vike-crud, vike-admin, vike-themes, vike-layouts, vike-toolbar, plus @vike-data/vike-schema and @universal-orm/core.

To close (work happens in the vike-data repo):
- decide the public package names first (they are inconsistent today: bare `vike-auth`, scoped `@vike-data/vike-schema`, scoped `@universal-orm/core`). This is the one bit worth a quick alignment before publishing.
- flip `private`, set real versions, publish via changesets.
- then verify `--compose-extensions` scaffolds a real app in an empty dir outside the monorepo and it installs the extensions from npm.

Once this lands, the integrated reference app (#288) can be built anywhere, not just inside vike-data.

---
Source: https://github.com/gemstack-land/the-framework/issues/291
