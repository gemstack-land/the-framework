---
"@gemstack/framework": patch
---

Apply Rom's #559 review to the business-knowledge docs (#537): drop `README.md` (a repo's own `README.md` already covers the overview), move `DECISIONS.md` and `KNOWLEDGE-BASE.md` to the repo root, and show each doc's one-line gloss in the injected `Context:` too, not just the post-merge prompt. The `## Business knowledge` prompt text is now his verbatim wording.
