---
'@gemstack/ai-autopilot': patch
---

`FakeRunner`'s filesystem now lists the whole workspace for `.` and `/`, matching what the local,
Docker and WebContainer runners return.

It returned `[]` instead. `.` keys to the empty string, so the prefix built for the filter was `/`,
which no key starts with. Since `list_files` passes the model's `dir` straight through and `.` is
the most natural thing an agent types for the workspace root, a test could assert agent behaviour
on an apparently empty workspace where production hands back the full tree.
