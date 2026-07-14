---
"@gemstack/framework": minor
---

Assemble a run's system prompt in one place. The build path (`runFramework`) and the direct-prompt path (`runPrompt`) each inlined the same composition (the #326 prompt block, the always-on emit protocols, then the run's persona/skill/memory framing), and the two drifted apart, which is what dropped the #326 action layer from `--vanilla` builds (#500). Both now go through a single exported `composeRunSystem()` in `system-prompt.ts`, with unit tests pinning the order and the unconditional emit protocols so the two paths can never diverge again.
