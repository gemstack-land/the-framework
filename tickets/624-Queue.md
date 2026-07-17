# Queue

Two queues:
- Queue of human interventions needed
  - AI in-progress tasks awaiting user answer
  - AI finished tasks (ready to merge) requiring user review
  - New tickets pending user confirmation (agentic PM automatically proposes new tickets => user confirms)
  - New tasks pending user confirmation (agentic PM automatically proposes new tasks from ticketing => user confirms)
- Queue of confirmed tasks
  - pending tasks
  - future task confirmed by user
  - finished tasks (i.e. history)

---
Source: https://github.com/gemstack-land/gemstack/issues/624
