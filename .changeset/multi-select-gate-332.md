---
'@gemstack/framework': minor
---

Add a multi-select gate (`showMultiSelect()`): a dashboard checklist with pre-checked defaults that pauses the run and resolves to the selected subset. Built on the existing single-select choice gate (same panel and POST-back resolver), exposed as `requestMultiSelect()`; a headless run auto-accepts the default set. This is the primitive the [Research] preset uses to let the user pick which problems to deep-dive.
