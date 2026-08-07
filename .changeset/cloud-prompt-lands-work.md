---
'@gemstack/the-framework': patch
---

A `--run-on web` hand-off now reads like a message to a person and tells the cloud session to land its work (#1496, #1497). The prompt a claude.ai session receives is the one string a human actually reads when they open the session link, but it led with the framework's injected system framing and buried the task at the bottom; now the task comes first and each injected block follows behind a labeled `===` rule. And nothing ever told the session to publish: the local run ends at the hand-off, no local machinery can reach the cloud VM's workspace, so a session that left its results in the conversation — or in a gitignored `ANALYSIS_RESULT.md` — ended with "the session committed nothing" and no PR. The hands-off protocol now carries the missing half: commit on the session branch and open a pull request, write analysis/plan deliverables into committed files, and end without a PR only when the task genuinely required no repository change.
