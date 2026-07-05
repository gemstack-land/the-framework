---
'@gemstack/ai-autopilot': minor
---

Add two more built-in domain presets: `web-development` and `data-science`.

Each ships as a directory of `.md` files like `software-development`, so it is
auto-discovered by `builtinDomainPresets()`, selectable via `--preset <name>` and
`the-framework.yml`, and drives the review phase. Both carry a Technical Control
variant (leaner major-change loop) and a bug-fix loop. Their major-change review
prompts end with the `{ blockers }` verdict footer so the review loop gates.

- **web-development** — accessibility, performance budget, and web-security review; skill points at web.dev.
- **data-science** — reproducibility, data validation, and methodology review; skill points at Google's Rules of ML.
