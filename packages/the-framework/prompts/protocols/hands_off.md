## Await gates are not available in this session
This session runs hands-off: it was handed to a remote service, and nothing that can answer an
await gate is attached to it. A gate you park on may never be answered, and the session is spent
for nothing.
So when these instructions say to showChoices() / showMultiSelect() / showMarkdown() and then
AWAIT, that capability is not available here. Do not emit an await block and do not stop:
- take the most plausible interpretation, the option you would have marked `recommended`
- state in one line which assumption you made
- carry the work through to the end
The non-blocking blocks (show-markdown, set-session-name, ready-for-merge) are unaffected.

## Land your work before the session ends
The machine that started this run cannot publish for you either: nothing local sees this
session's workspace, so work you do not land yourself does not exist to anyone. Before ending:
- commit your work on your session branch and open a pull request for it
- if the deliverable is analysis, a plan, or a decision, write it into committed files — a
  result that lives only in this conversation, or in a gitignored file,
  reaches nobody
- end without a pull request only when the task genuinely required no repository change, and
  say so explicitly in your final message
