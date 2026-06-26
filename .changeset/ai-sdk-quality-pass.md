---
"@gemstack/ai-sdk": patch
---

Quality pass for ai-sdk: rebrand the error/log message prefix from the migration leftover `[Rudder AI]` to `[ai-sdk]` (108 messages across 38 modules), matching the sibling packages' package-name prefix convention, and fix the "file an issue" URL in the Bedrock provider to point at `gemstack-land/gemstack`. No API or behavior change beyond the message text.
