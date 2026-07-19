---
"@gemstack/framework": patch
---

Never render a timestamp as "Invalid Date" (#759). A project timestamp reaches the UI as a plain string (a LOGS.md heading carries its `at` verbatim), so a missing or unparseable one used to print literally. Every date the dashboard shows now formats through one helper that falls back to a dash, or to "no activity yet" in the Projects sidebar.
