---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': minor
---

Move the framework page builder off the preset onto its skill (fully skill-driven framing)

A framework was represented twice: its page-builder persona rode the preset seam (`preset.personas`, framed as the run's base) while its docs rode the skill seam (`vike.dev/llms.txt`). This finishes the "framework = skill, adapter axis gone" design: a `Skill` now carries its own curated framing personas alongside the doc pointer, so all of a framework's knowledge lives in one unit. `vikeSkill` carries `vikePageBuilder`; the new `nextSkill` carries `nextPageBuilder`. A preset is now a pure detector that points at its framework `skill`, and `run.ts` frames the page builder through the skill set (the detected preset's skill is always framed, even on an empty from-scratch project where nothing signal-matched, since preset selection is the fallback). New exports: `nextSkill`, `skillPersonas`. `presetPersonas` and the framing narration are unchanged. Part of #190.
