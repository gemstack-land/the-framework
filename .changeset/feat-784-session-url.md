---
"@gemstack/framework": minor
---

Address a session by URL (#784). The dashboard's selection is now its address: `/` is the Overview, `/{projectId}` a project's home, `/{projectId}/{sessionId}` one session. A session is a link you can paste, reload, bookmark, and open two of side by side, and Back/Forward walk the sessions you looked at. Selection used to be three pieces of React state reconciled at render, which is where #761/#766/#768/#774 all came from; a route cannot disagree with itself. A URL naming a session or project that no longer exists says so rather than silently bouncing you elsewhere.
