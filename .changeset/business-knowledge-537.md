---
"@gemstack/framework": minor
---

Collect business knowledge in the repo (#537). Every run now puts `.the-framework/README.md`, `.the-framework/DECISIONS.md` and `.the-framework/KNOWLEDGE-BASE.md` on the `Context:` line, so the agent reads whatever the project already knows about itself, and the post-merge prompt gained a `## Business knowledge` section asking it to fold back what the session taught that the code cannot show. The docs go with the built-in system prompt: `--vanilla` still injects nothing but the user's own dirs. `--eco-auto-maintenance` now drops the post-merge prompt's `## Maintenance` section instead of skipping the whole run, which would have taken business knowledge with it.
