---
'@gemstack/framework': patch
---

Dashboard: the "New preset" form is now a centered modal dialog instead of a panel that pushed the composer controls down. Same fields (name, prompt, and the "Save to" scope choice); a backdrop click, Esc, or the close button dismisses it. Adds a reusable shadcn-style `Dialog` on Base UI for future forms.
