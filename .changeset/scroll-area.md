---
"@gemstack/framework": patch
---

Give the rails and panels a scrollbar you can see (#913). The Sessions rail, the Docs / Tickets / Log panels, the agent's views and choices, and the Overview all scrolled behind the OS scrollbar, which on macOS hides itself: a rail full of sessions looked like a rail with nothing more in it. They now use shadcn's Base UI scroll area, themed from our own tokens, present for as long as the content overflows and darkening under the pointer. A panel whose content fits still shows no bar at all.
