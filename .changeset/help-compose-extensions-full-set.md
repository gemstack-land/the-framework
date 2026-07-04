---
'@gemstack/framework': patch
---

Fix the `--compose-extensions` help text to name the full composer set

The `framework --help` output described `--compose-extensions` as composing "vike-auth for auth" only, but the flag frames the agent with the whole vike-* composer set: auth, the universal-orm data layer, rbac, crud/admin, and themes/layouts. The help text now names them accurately.
