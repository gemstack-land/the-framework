---
'@gemstack/framework': minor
---

The built-in system prompt is now Rom's #326 text, verbatim, replacing the anti-lazy-pill it grew out of: unclear scope becomes a ranked `showChoices()` list, a large scope a `PLAN_<session>.agent.md` to approve, a very large one also a `TODO_<session>.agent.md` backlog, an alternatives pass rates problem "variability" before code is written, and edits to existing code stay minimal. The prompt is a template (#350): `${{ ... }}` JS fragments render against the run context, so `tf.params.autopilot` relaxes the maintenance stance on autopilot runs and `${{tf.prompt}}` carries the user prompt slot. New exports: `SYSTEM_PROMPT_TEMPLATE`, `renderSystemPrompt`, `renderTemplate`; the `ANTI_LAZY_PILL` export is gone (the `antiLazyPill` config key still toggles the built-in prompt). `--autopilot` now has an effect without a preset.
