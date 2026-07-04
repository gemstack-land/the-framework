---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': minor
---

Thread an active extension's own skills into the agent frame

The extension SPI (#190) let a `FrameworkExtension` carry `skills` (llms.txt doc pointers), but `run.ts` only framed the built-in `SkillRegistry` matches, so a discovered extension's own skills were collected and then dropped. Add `composeSkills` (symmetric with `composePersonas`): it unions the registry-matched skills with every active extension's skills, deduped by name. `run.ts` uses it, so an active extension now contributes both its personas and its doc pointers to the frame. Surfaced by the new `examples/framework-discovery-demo` end-to-end proof, where the third-party `framework-hello` extension's `hello-guide` skill now reaches the agent.
