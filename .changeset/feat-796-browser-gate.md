---
'@gemstack/framework': minor
---

An agent working in a browser can now hand it to a human instead of failing. When it hits a login wall, a captcha, or an SSO step, it ends the turn with an `await-browser` block; the run parks, the user acts on the page, and the agent continues with whether it was handled. It never types a password and never attempts a captcha. An unattended run answers "could not handle it", so an agent is never told a human cleared a wall that is still there.
