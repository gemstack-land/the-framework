---
"@gemstack/framework": patch
---

Reject `--resume-session` on a run kind that cannot honor it (#782). Only the direct-prompt path resumes an agent conversation; a build run took the flag and dropped it, so the run started fresh and looked like it had continued while having silently lost the context. It now fails with a usage error instead.
