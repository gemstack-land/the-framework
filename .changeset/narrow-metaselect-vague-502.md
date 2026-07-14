---
"@gemstack/framework": patch
---

Stop the AI meta-select step from auto-picking a domain preset for a vague, goalless request. The benchmark (#502) showed the router over-firing on unclear-goal prompts ("clean this up", "make it better") — guessing a preset from the workspace when the task itself had no concrete goal. The selection prompt now tells it to return `none` (the plain flow) in that case, so a domain review loop only kicks in once the goal is clear.
