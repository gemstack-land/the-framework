---
'@gemstack/framework-dashboard': patch
'@gemstack/framework': patch
---

Make the run-options menu say only what the code delivers (#801).

- **Autopilot** no longer claims it "also relaxes the maintenance stance". #556 moved that section out of the system prompt, so the choice-gate countdown is its whole effect. Stale comments in `cli.ts` and `run.ts` asserting it steers the prompt are corrected too.
- **Eco > Auto maintenance** is gated on Post-merge cleanup. It trims the on-before-mergeable prompt, not the built-in one, so on its own it dropped nothing. The `--eco-auto-maintenance` CLI help said the same wrong thing and now points at the right prompt.
- **Browser** is disabled with a reason off Claude Code. The browser is wired through Claude Code's MCP config and other drivers take no MCP servers, so the box was checkable and inert. The CLI already warned via `unguardedNotices`; the dashboard was silent. `collectRunOptions` now also stops sending `browser` for a non-Claude agent, so the disable is real rather than cosmetic.

Also fixes an Eco sub-row bug found on the way: the sub-drops rendered a `disabledReason` but ignored `disabled`, so a gated one would have looked disabled and still written through on click.
