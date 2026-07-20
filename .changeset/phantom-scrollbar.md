---
"@gemstack/framework": patch
---

Stop the dashboard growing a second, phantom scrollbar (#904). The document itself was scrollable next to the content pane's own scrollbar, and dragging it slid the whole app, header and all, off the top of the window. Visually-hidden labels are absolutely positioned, and with no positioned ancestor they escaped the workspace row's clipping and kept their place deep inside the scrolled content, which is what the browser measured the page against. Only the pane scrolls now.
