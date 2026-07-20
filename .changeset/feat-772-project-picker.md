---
"@gemstack/framework": patch
---

Replace the projects sidebar with a project dropdown in the top nav (#772). The left-most rail existed to answer one question, which project am I on, and it spent a full column on it while pushing the sessions rail, the main pane and the views rail into what was left. The selection is now a dropdown in the nav: it is shown on every page including the Overview, it keeps the "needs you" badge the rail carried, and `Add project` keeps its trust confirmation. The `New session` button also returns, now that the nav's shape is settled.
