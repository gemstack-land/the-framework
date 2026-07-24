---
"@gemstack/the-framework": minor
---

One shared sidebar on every route, rebuilt on the shadcn Base UI sidebar.

The sessions rail used to vanish the moment no project was selected, so the home/Overview had no left column while a session page did. It is now the shadcn Base UI sidebar, rendered on every route, so the two read as the same app.

On the Overview it pools recent sessions across every project (a new cross-project read), each row naming its project and jumping into it when selected; a selected project still shows its own runs.

"New" is now project-aware: with no project it opens the add-project dialog (there is nowhere to run a session yet), with one project it starts there, and with several it opens a picker so you choose where. In a project already, it starts another session there.
