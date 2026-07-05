---
'@gemstack/ai-autopilot': minor
---

feat(ai-autopilot): add Product Management and Biological Science domain presets (#275)

Ships the last two of Rom's #204 domain list as built-in Open Loop presets, so the set is now five: Software Development, Web Development, Data Science, Product Management, and Biological Science.

- **Product Management** reviews a substantial change against the requirement it serves, the experience it gives the user, and whether its success is measurable; a fix traces the user impact and root cause before it is locked in. Technical Control runs the leaner requirements review only.
- **Biological Science** reviews an analysis or pipeline for sound experimental design, trustworthy data provenance, and statistical rigor; a fix traces the analytical cause before it is locked in. Technical Control runs the experimental-design review only.

Both are pure `.md` content under `presets/`, auto-discovered by `builtinDomainPresets()`, so meta-select and `--preset` can route to them with no further wiring. Each ships a real stable skill reference (Shape Up; Ten Simple Rules for Reproducible Computational Research).
