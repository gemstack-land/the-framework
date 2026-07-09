# Roadmap 🚀

> [!NOTE]
> - Also includes brainstorming ideas

## TODO

Selected: implement now-ish.

- Bootstrap mode
  - VALUE-HIGH (potentially groundbreaking, if we manage to make AI autonomously create advanced apps)
  - The `PLAN.md` + `TODO.md` trick: https://github.com/gemstack-land/gemstack/issues/297#issuecomment-4913683778
    - Try: also install it as system prompt injected to *all* prompts (not only when boostraping, let's see if it's sometimes counterproductive)
  - Ideas/brainstorming (don't implement yet)
    - PM system prompts:
      - "When it isn't clear, ask what the ultimate goal is (success startup, just a prototype, a project for a client, ...)
      - Make AI lead some product management discussions (no clue yet how exactly this would look like)
- Queue
  - VALUE-HIGH
  - A global queue of prompts to be fired whenever there's capacity
  - Required for boostraping
  - Technically, it's just a `TODO.md` file (git repo, no database)
- Usage limit maxing
  - VALUE-HIGH
  - Cron jobs to max-out daily usage limits (fires queue)
  - Implementation
    - Accessing usage limits: https://github.com/gemstack-land/gemstack/pull/300#issuecomment-4918256151
  - Marketing
    - Easy sell (sexy feature, clear added value)
    - Unique USP (since Claude has no interest to implement this)
    - Attracts prolific AI users (more likely to be early adopters of The Framework)
    - Landing page illustration idea: progress bar "used AI daily budget" (without The Framework => red bar, with The Framework => green bar, a "candy" progress bar that looks like a skills progress bar in MMORPG video games)
  - Ideas/brainstorming (don't implement yet)
    - `Auto`-model chooser (use cheap model to analyze prompt and select the right model)
    - Allow user to select max quota budget (in %) per prompt
- Dashboard

## Candidates

Candidates: implement soon/now?

- Don't reapeat yourself
  - VALUE-HIGH
  - AI-human seam files: `KNOWLEDGE_BASE.md`, `DECISIONS.md`
    - TODO: maybe develop system prompts to ensure these are maintained?

## Later

Nice, but let's implement later.

- Auto triggers
  - VALUE-HIGH
  - GitHub CI red => trigger agent
  - Sentry red => trigger agent
  - TODO: check if hard to implement?
  - Implementation
    - Bad: requires integrations with many providers (not every company uses GitHub)

## Postponed

Postponed: don't implement yet.

- Mobile app
  - VALUE-LOW
- Scaling
  - For large codebases: `CODEBASE_OVERVIEW.md`
  - VALUE-LOW
- Sandbox
  - VALUE-HIGH
  - IMPLEMENTATION-COMPLEX
    - Not sure how secrets (e.g. production env vars) can sandboxed from AI
    - Ideally sandboxing happens on a directory-level (spanning over multiple repositories), so that AI can access multiple repos at once.

## To research

- Product manager agent
  - VALUE-?? (no clue how much value, but potentially massive value — to be tested. Because AI is bad at writing documentation, I suspect it's going to be bad at being a product manager, but let's see.)
  - Bunch of `.md` files as seam between AI and humans? `BRAINSTORMING.md`, `FEATURE_REQUEST.md`
- Maintenance
  - VALUE-MEDIUM
  - Root `MAINTENANCE.md`: lists all files (the file structure)
  - A `.maintenance.md` per file: lists all functions
  - Three ratings: maintainability, human readability, security
  - High-quality prompts:
    - [Highly-effective code refactoring prompt](https://gist.github.com/brillout/8abfd310bad5df422ae56c5c9066ffc5)
      - Let's break this prompt in two: one for maintainability (e.g. DRY), and a second one for readability (so that humans can easily read the code)
        - Try the readability prompt on brand-the-framework (it has lots of potential for top-down code structure refactoring)
    - Security audit (TODO: develop scurity audit prompt)

## Untriaged

TODO: triage the following.

- Autopilot mode: minimum intervention, automatic code refactoring (for maintainability), automatic security audit, automatic new feature requests (related: product manager agent), automatic feature request implementation
  - VALUE-HIGH (potentially groundbreaking)
- Technical control mode => review only
  - VALUE-MEDIUM
  - Highly polished PRs:
    - Nice three-level PR overview: TLDR, summary, and details
    - Minimal changes in PR (clean refactoring in susbsequent PR)
- TLDR thinking out loud
  - VALUE-MEDIUM
  - Show TLDR of the model's thinking (=> nice overview of all the thinking done during this session)
  - Also show live thinking (same thinking-out-loud as Claude Code => just forward the Claude Code CLI output)
  - Show used skills, opened URLs, commands ran
- Notifications
  - VALUE-MEDIUM
- Give AI access to GitHub issues/discussions
  - VALUE-HIGH
  - Implementation
   - Ideally, AI can access the entire text of all issues (and optionally even all comments)
   - Complex to implement?
  - Alternative: don't use GitHub issues at all for product management?
  - Maybe sync between GitHub issues and a repo file.
