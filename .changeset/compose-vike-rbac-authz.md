---
'@gemstack/ai-autopilot': minor
---

Compose vike-rbac for roles/permissions instead of hand-rolling authz

The crud composer teaches ad-hoc role checks (`canEdit: (user) => user?.role === 'admin'`), which is fine for signed-in-vs-not but leaves the agent to hand-roll a roles/permissions schema and a permission checker the moment an app has named permissions or more than one role. The new `vike-rbac-composer` persona (wired into `vikeExtensionPersonas`, between auth and crud) teaches the agent to compose vike-rbac instead: declare permissions with `definePermissions` and `extends: ['import:vike-rbac/config:default']` (self-installs vike-auth), route every guard through the same `can(user, permission)` / `hasRole(user, role)` (the crud `canView`/`canEdit`, page guards, session scope, and vike-actions guards all delegate to it), and seed roles/permissions from the composed registry with `seedRbac()` rather than a hand-written list. vike-rbac owns the `roles`/`permissions`/`role_user`/`permission_role` tables and is the guard subject vike-admin and vike-actions are built around. No runtime change; the agent stays a black box. Part of #186. Closes #194.
