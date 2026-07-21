---
'@gemstack/framework': patch
---

Dashboard: make the `dark:` utilities follow the theme toggle instead of the OS.

Tailwind v4 compiles `dark:` to `@media (prefers-color-scheme: dark)` unless a custom variant
says otherwise, but the dashboard's tokens live on the `.dark` class that LayoutDefault toggles.
The two disagreed: picking Dark on a light OS applied the dark tokens while leaving every
`dark:text-*` rule unapplied, so diff counts, the stream-lost banner and the daemon-health banner
kept their light-mode colours on a dark canvas (and the reverse on a dark OS set to Light).
Declaring `@custom-variant dark` binds both to the same signal.
