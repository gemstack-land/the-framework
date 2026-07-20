---
"@gemstack/framework": patch
---

Per-project settings now actually save (#866). The daemon serves a prebuilt dashboard and so registers each telefunction by hand, and the two per-project preference ones were never added to that list. Every read and write of a project's own settings answered 400, the caller discarded the rejection, and the dashboard went on showing the value you picked, so a setting looked saved until the next reload threw it away. Per-project run options (#800) silently fell back to the global ones.

A test now holds the registry against the telefunc modules' own exports, so a telefunction that is added but never registered fails the suite instead of failing in the daemon.
