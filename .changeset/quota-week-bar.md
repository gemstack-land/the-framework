---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

The usage panel is one week-long bar, with the limit on a slider (#960)

Usage used to be two flat meters: how much of the week was gone, and separately how much of it
was allowed by now. They were the same axis drawn twice, so nothing on screen said the second
was a line through the first.

Now the track *is* the week, edge to edge, labelled by day. The fill is what has been spent, a
mark shows the boundary, and the colour is the two compared: green under it, blue tracking with
it, orange ahead of it, red once the week is gone.

The line unattended work stops at is now yours to move. It is stored as an offset from the
boundary rather than a fixed percentage, so it travels with the boundary through the week
instead of being overtaken by it. Centre is the previous behaviour, which is what an install
that never touches the slider keeps.
