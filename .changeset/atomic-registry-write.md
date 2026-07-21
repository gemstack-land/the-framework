---
'@gemstack/framework': patch
---

The user registry (`~/.the-framework.json`) is now written atomically, and its mutators are
serialized.

The file holds the project list, the global preferences and every per-project override, and it
was written with a plain truncate-then-write while the reader treated a malformed file as an
empty registry. A crash, a kill or a full disk mid-write therefore erased all of it silently and
the next read reported a clean slate. The write now goes to a temp file beside the real one and
is renamed over it, the same shape the daemon state file got in #922, so a reader sees either
the whole old file or the whole new one and a failed write only damages the temp.

`addProject`, `removeProject`, `writePreferences` and `writeProjectPreferences` each read the
whole registry, edit it and write it back, and one daemon runs several concurrently. Interleaved,
the later write was computed from a read taken before the earlier one landed and silently dropped
it. They now queue through a single tail promise.

`RegistryFs` gains an optional `rename`; the node-backed implementation always provides it.
