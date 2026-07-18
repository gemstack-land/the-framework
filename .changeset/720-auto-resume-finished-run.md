---
"@gemstack/framework": minor
---

Resume a finished run by messaging it (#720). After a run ends (Stop, or it finishes) the dashboard used to drop the chat composer, so the conversation was a dead end. The finished-run view now keeps a composer, and sending a message spins a fresh run whose opening prompt `--resume`s the ended run's captured session id, continuing the same conversation with full prior context. New plumbing: `DriverStartOptions.resumeSessionId` seeds the Claude Code session so its very first prompt resumes (the framing is skipped, since the resumed transcript already carries it); `AwaitRoundsOptions.resume` / `RunPromptOptions.resumeSessionId` carry it through `runPrompt`; and it threads from the dashboard as `StartRunOptions.resumeSession` -> the `--resume-session <id>` CLI flag. A continuation is sent as a `prompt` run; a fresh run is byte-identical to before.
