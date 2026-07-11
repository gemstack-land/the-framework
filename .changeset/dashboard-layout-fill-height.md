---
'@gemstack/framework': patch
---

Make the dashboard layout fill the viewport height. `#layout` only grew to its content height, so on a short page the runs-sidebar right border stopped partway down instead of reaching the bottom. Give `#layout` a `min-height: calc(100vh - 57px)` (matching the sidebar's existing header-height key) so the stretched sidebar runs full-height.
