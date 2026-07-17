---
'@gemstack/framework': patch
---

Give the run-form disclosures one consistent style (#659). "See actual prompt sent" and "Context" were styled differently (different triangle glyph, weight, and indent); both now use a shared `DisclosureToggle` — a chevron that rotates when open, then the label — so they read as the same control.
