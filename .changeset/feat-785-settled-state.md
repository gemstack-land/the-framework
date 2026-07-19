---
"@gemstack/framework": minor
---

Tell a settled session from a working one (#785). A run that finished its work stays open as a conversation, so it kept reporting `running` with a pulsing dot until the user closed it, whether the agent was mid-edit or had been idle for an hour. A run now says when it parks (`settled` event, `RunMeta.settledAt`), and the sessions rail reads "waiting" with a still dot instead of animating at you.
