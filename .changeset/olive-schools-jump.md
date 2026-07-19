---
'@gemstack/framework': patch
---

Continue a finished session even when its agent conversation is gone (#778). Resuming passes the captured session id to the agent CLI, which refuses it once the conversation has left its history. The driver now retries that turn once without the resume flag, so the session continues as a fresh conversation and says so in the event log, instead of failing with the reason buried there.
