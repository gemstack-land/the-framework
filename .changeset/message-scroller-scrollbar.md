---
"@gemstack/framework": patch
---

Give the chat log back its scrollbar styling (#914). Our port of shadcn's message-scroller dropped the styling upstream puts on its viewport, because those classes come from a Tailwind plugin we do not have. They are back as three small local utilities on plain `scrollbar-width` / `scrollbar-color` / `scrollbar-gutter`: the log's bar is toned like the rest of the app, its width is reserved so arriving output does not shift the text sideways, and it goes quiet while the log is chasing the live edge. The log's bottom edge now fades out while there is more below it, and the fade is gone at the live edge so the newest line is never dimmed.
