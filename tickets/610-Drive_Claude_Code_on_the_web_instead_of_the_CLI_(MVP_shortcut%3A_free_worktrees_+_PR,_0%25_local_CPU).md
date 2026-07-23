# Drive Claude Code on the web instead of the CLI (MVP shortcut: free worktrees + PR, 0% local CPU)

> Captured from team discussion. Flagged as a potentially large MVP shortcut. The mechanism (how we drive it) and session/login are open; needs a spike.

## Idea

Add a driver that uses Claude Code on the web instead of the Claude Code CLI. We drive the web UI programmatically and let it run the task, rather than running the CLI locally.

## Why it's a big shortcut

- Claude Code on the web already does the whole Git worktree dance and opens the GitHub PR. We reuse that flow instead of building it (relates to #453).
- It runs off the user's machine: roughly 0% local CPU, so AI tasks parallelize essentially without limit.
- It is where at least some of us already work day to day.

## How to drive it (open)

- **Chrome extension**: the first idea. Simple-ish, but an install plus configuration.
- **Headless browser automation**: drive the web UI in a server-side headless browser (no install, seamless). Could reuse the headless-streaming primitive from the preview capability (#609), though the purpose is different (driving the agent vs previewing the agent's browser).
- Decision pending; a spike should compare the two on the hard part below.

## The one hard part: session / login

- [ ] Confirm we can drive an authenticated Claude Code web session programmatically (headless or via extension). This is the main unknown and likely decides extension vs headless.

## Related

- #495 (BYOS): the CLI path for "use the user's own agent". This is the web analog.
- #453 (git worktrees): the web flow does this for us, reducing what we build.
- #609: a separate idea, but shares the possible headless-browser mechanism.
- #605 (daemon): where a server-side headless driver would run.

---
Source: https://github.com/gemstack-land/the-framework/issues/610
