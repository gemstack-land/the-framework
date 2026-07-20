---
'@gemstack/framework': patch
---

The project log survives a multi-line prompt (#897)

`.the-framework/LOGS.md` is committed history, but a run's entry wrote the prompt straight
into the entry's heading. A prompt spanning several lines spilled the rest of itself into the
file as loose text, where reading the log dropped it; a prompt containing a line that looked
like a heading forged a second entry, and one that looked like a status line rewrote the real
one.

A title and a prompt bullet are now escaped to a single line on write and unescaped on read,
so a prompt round-trips whole whatever it contains. Logs written before this still read fine.
