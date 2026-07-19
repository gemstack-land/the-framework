---
"@gemstack/framework": minor
---

Tighten the composer (#756). The prompt area reserved room for text nobody had typed: a resting height of `4.5rem` in the full form, with the control row and its containers padded to match. The editor grows with its content up to the same maximum as before, so the tall empty box bought nothing.

The resting height drops to `2.75rem` (`2rem` in the navbar), the editor's vertical padding and the gap to the control row tighten, the submit button matches the size of the agent/model and options controls beside it rather than standing a size larger, and the three frames around it (`RunChat`, `RunResumeChat`, `StartRunForm`) lose a step of padding.

Scoped to the composer on purpose: the prompt, its send button, the model select and the options gear.
