---
'@gemstack/framework': minor
---

Select the model from the dashboard (#628): a model picker sits under the prompt textarea (Default / Opus / Sonnet / Haiku) and persists as a `model` preference. It flows through as the run's `--model`, so the wrapped agent runs on the chosen model; empty means the driver's own default (no flag). A full model id set directly in the registry works too — the aliases are just the common Claude Code ones, since it is the default driver.
