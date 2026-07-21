---
'@gemstack/framework': minor
---

Dashboard: semantic status colours, a real Checkbox, a stable Sessions rail, and no emoji glyphs.

The status colours are now four tokens (`--success`, `--warning`, `--danger`, `--info`) tuned per
theme, replacing every raw palette value. Before this, "good" was six different greens, `amber-500`
meant both "stopped" and "building, fine", and the flat `-500` tones sat near 2:1 contrast on the
light canvas.

Checkboxes are a shadcn-style primitive on Base UI instead of bare `<input type="checkbox">`, so
they follow the theme and carry the same focus ring as everything else.

The Sessions rail no longer collapses to a strip when the right rail opens the Browser or Views
tab; its width is now constant.

The ✅/❌/⚠️ glyphs in the Enhanced System Prompt disclosure are replaced by a status dot and plain
text, matching how every other state in the app is drawn.
