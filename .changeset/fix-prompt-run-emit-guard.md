---
'@gemstack/framework': patch
---

Stop a throwing onEvent listener from escaping a prompt run (runPrompt).

runFramework wraps each `opts.onEvent(event)` call in a try/catch and logs-and-ignores a listener
that throws, but runPrompt's emit did not. Because emit is called both inside and outside the run's
try block (the session-start and system-prompt events fire before it), an onEvent listener that threw
could escape runPrompt uncaught, or skip the run's `end` event. runPrompt now guards the listener the
same way, so a bad listener can no longer take the run down.
