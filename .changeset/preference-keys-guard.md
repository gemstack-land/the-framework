---
'@gemstack/framework': patch
---

PREFERENCE_KEYS is compiler-enforced complete against Preferences (#944)

The boolean key list is now derived from a Record over the boolean keys of the Preferences type,
so omitting a newly added boolean preference fails the build instead of making
sanitizePreferences silently drop it on every save (write-then-vanish). No runtime behavior
changes today; this closes the failure shape for every future preference.
