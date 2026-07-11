---
'@gemstack/framework': minor
---

Thread the #314 Global options through the run engine (#370). `POST /api/start` now carries an `options` object which the daemon turns into CLI flags: `--vanilla` removes the built-in #326 system prompt entirely (raw Claude Code), and `--eco-auto-planning` / `--eco-auto-research` / `--eco-auto-maintenance` drop the matching #326 sections to save tokens (Autopilot and Technical keep mapping to modes). `system-prompt.ts` drops the Eco sections at render, so the #343 Prompts panel reflects the toggles live; the #326 template stays byte-identical. The dashboard panel that drives these lands separately (#371); all fields default off, so today's behavior is unchanged.
