---
"@gemstack/the-framework": patch
---

Fix the navbar overflowing the page at narrow widths.

Below a narrow viewport the top nav pushed the whole document wider than the screen, so the page scrolled sideways and slid the app off-screen. The cause was the nav's fixed clusters: the brand mark plus wordmark on one side and the "New session" button plus the icon buttons on the other were both `shrink-0`, so together with the project picker they could not fit a phone-width viewport.

Below `sm` the nav now folds down to what fits: the brand keeps its mark (still the link home) but drops the "The Framework" wordmark, the "New session" button collapses to its `+` icon (still labelled for a screen reader), and the project picker caps narrower and truncates a long name. At `sm` and up everything is exactly as before. Verified by driving a real browser at 375px and 420px (no page scroll) and at 1200px (labels back); jsdom cannot see this class of layout bug.
