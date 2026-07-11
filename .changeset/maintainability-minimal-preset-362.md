---
'@gemstack/framework': minor
---

Add a [Maintainability (minimal)] preset button on the dashboard (#362) beside the existing [Maintainability] one (#361), as a deliberate A/B. The minimal variant prefills the bare prompt "Look for maintainability red flags, and fix them." with no target scope and no goal framing, where #361 adds a `<PARAM:what>` target and a "make it as maintainable as possible" lead line. Both prefill the start textarea for review/editing and run verbatim as a direct prompt. Once the comparison settles, the losing variant will be removed.
