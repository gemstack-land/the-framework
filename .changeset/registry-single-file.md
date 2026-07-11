---
"@gemstack/framework": patch
---

Store the multi-project registry as a single file, `.bashrc`-style: `$HOME/.the-framework.json` (or `$XDG_CONFIG_HOME/the-framework.json`) instead of a `projects.json` nested inside a `.the-framework/` directory (#390).
