---
'@gemstack/framework': patch
---

Dashboard: fix the Usage card's dividers rendering at full text brightness, and stop the
Overview cards stretching into empty space.

Tailwind v4 defaults an uncoloured `border-t` to `currentColor`, so the three dividers in the
Usage card painted at `oklch(0.95 0 0)`, the body text colour, against hairlines that are
`oklch(0.3 0.01 264)` everywhere else in the app. They now use the border token.

The two Overview card rows also stretched each card to its neighbour's height, so on a quiet
board half of "Session outcomes" and most of "Working now" were empty card. They are now two
column stacks that size to their content, which pairs the tall chart against the tall list and
brings the Projects table a full screen higher.
