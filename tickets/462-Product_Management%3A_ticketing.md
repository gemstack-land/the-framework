# Product Management: ticketing

There might be tremendous value in saving a copy of all the tickets (e.g. GitHub Issues) inside the Git repo.

```
tickets/1337-Some_Feature_Request.md
tickets/4200-Some_Other_Feature_Request.md
```

- We two-way-sync `tickets/*` with GitHub issues
  - Because humans prefer UIs (e.g. GitHub issues), while agents prefer text
  - Synced ticket body: `cat 1337-Some_Feature_Request.md` <=> body of `https://github.com/org/repo/issues/1337`
  - Title encoding: ` ` => `_`, `_` => `%5F`, filesystem problematic chars => `%xx`
  - Discussions only happen on GitHub (no syncing)
  - Convention: ticket body includes the approved goal (the consensus)
- We can then ask AI things like:
  - "Read all tickets and suggest a PLAN.md" => once PLAN.md approved => materialize into TODO.md
  - "Read the discussion at #1337 and update the ticket body" => updates both Git ticket and GitHub issue (thanks to auto-sync)
- When a ticket is done => remove it (it's still available via `git log -p`)

Very tempting to work on it today (big dogfooding potential), but I'll evaluate the priority for this once we're done with the MVP and landing page.

@suleimansh You mentioned that you use GitHub issues as a seam between you and AI — feel free to elaborate. Let me know if you think this ticket doesn't add *that* much value in your experience.

AFAICT, the biggest added value is that AI can fully access all tickets without having to make any GitHub requests. Another massive added value is that the user can use AI to manage tickets ("create new umbrella ticket that lists all product managment ticktes", "correctly label all tickets", "create labels and suggest a PLAN.md"). Also, it's lossless and reviewable (thanks to Git).

Using Git to manage tickets isn't a new idea, but I think AI brings this idea to a whole new level.

Discussion and feedback welcome.

See also:
- [Script one-way-syncing `CHANGELOG.md` => GitHub releases](https://github.com/vikejs/vike/tree/main/.github/workflows/sync-github-releases) ([permalink](https://github.com/vikejs/vike/tree/15c05abaeae57bc3112702a8faeca36c20ee13ea/.github/workflows/sync-github-releases)) — shows GitHub API usage, including some gotchas

---
Source: https://github.com/gemstack-land/the-framework/issues/462
