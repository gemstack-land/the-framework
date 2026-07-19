---
"@gemstack/framework": minor
---

Adopt the brand mark (#757). The hexknot from the brand generator replaces the bare wordmark in the dashboard header and the relay view, and ships as the tab favicon.

Its six strands carry a neutral ramp that runs dark-to-light, which would sink the leading strands into a dark canvas, so the fills are CSS variables: the brand values in light, a lightened ramp in dark. Not `currentColor` with per-strand opacity, which is the usual way to make an SVG theme-aware but is wrong for a knot: the over/under crossings are literal overlaps, so any strand below full opacity shows the one beneath it through the crossing. The favicon carries its own `prefers-color-scheme` ramp inside the file, since a tab icon follows the OS theme rather than the in-app choice.
