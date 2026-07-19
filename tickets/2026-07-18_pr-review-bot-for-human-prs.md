# PR review bot for human-authored PRs

## TLDR

Automatically run the `review` + `security-audit` presets on human-authored PRs (not just the agent's own output), posting findings as inline PR comments.

## Why it matters

Today every quality preset (`review`, `security-audit`, `readability`, `maintainability`, `ux`) only ever runs against work the agent itself just produced — triggered from inside a `framework` run. A human engineer who opens a PR by hand gets none of this: no automatic review, no security pass, nothing. That's a big share of the value left on the table for teams that don't (yet) let the agent write all their code, and it's a natural "whole team benefits, not just the person who typed `framework ...`" story for the open-source pitch (#455).

Concretely: watch each registered project (the same registry `~/.the-framework.json` already tracks, #313/#462) for newly opened or updated **human** PRs (author isn't the framework's own bot/commit pattern), and automatically run the `review` + `security-audit` presets against the diff, posting findings as inline PR review comments on GitHub — the same posture `/code-review --comment` already has for an interactive session, just fired automatically instead of on request.

## Rough shape

- Trigger: extend the existing background-jobs listener idea (#298, "CI is red on main => triggers agent") with a sibling listener — "human PR opened/synced => triggers agent" — polling `gh pr list` per registered project (the interventions queue, `dashboard/interventions.ts`, already polls PRs, so the plumbing to watch PRs exists).
- Guard: skip PRs authored by the framework's own runs (avoid reviewing its own output twice) and respect the existing usage-limit/margin guard from #298 before firing.
- Output: inline `gh pr review`/comment API calls per finding (reuse whatever comment-posting the `--comment` review flow already implements), plus a summary comment. No auto-merge, no auto-fix — purely advisory, same trust level as a human reviewer leaving comments.
- Surfacing: reviewed PRs show up as "reviewed by The Framework" in the dashboard's per-project PR list; a failed/blocking finding could optionally push the PR into the "Needs you" queue (#624) as "reviewed, N blocking comments."
- Settings: per-project opt-in toggle (default off) plus which presets to run on human PRs (start with `review` + `security-audit`; `readability`/`maintainability`/`ux` optional).

## Related

- #298 (background jobs / listeners) — sibling listener, same usage-guard machinery.
- #624 (queue) / `dashboard/interventions.ts` — where a blocking review result should surface.
- #625/#608 (modular opt-out) — must be an explicit per-project opt-in, not on by default.
