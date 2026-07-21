---
'@gemstack/framework': patch
---

Reply-mirror bindings are released once their run is gone (#941)

Nothing ever unbound a chat-touched run, so every binding stayed in the map for the daemon's
lifetime and each 3s poll scanned every project's live metas per bound run — IO that only ever
grew. The daemon's conversation reader now answers `undefined` for a run with no live meta
anywhere (archived, or its project removed), and after a few consecutive misses the mirror drops
the binding and logs it. A transient miss (or a throwing read) still costs one poll, not the
binding, and a fresh bind gets the same grace against the meta-not-yet-on-disk race.
