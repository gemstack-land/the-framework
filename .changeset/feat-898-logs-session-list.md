---
'@gemstack/framework': minor
---

The project log is the complete list of sessions (#898)

`.the-framework/LOGS.md` is the one part of a project's run history that git keeps, but it only
recorded runs that finished cleanly: a stopped or crashed session left nothing behind, even
though the transient `runs/` archive had it. The entry is now written as the run settles, on
every path out, so the committed log stops disagreeing with the machine's own record.

Each entry also carries the run id, the name the agent gave the session, and the branch the
work landed on, read from the checkout while it is still there. So an entry now says where to
find the session and its code, rather than only that it happened.
