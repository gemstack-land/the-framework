# Syncing UI<->data

There seem to be fundamental question about how the UI should be synced with the data it shows.

So far, I think the best approach is to treat the filesystem (more precisely speaking, all the Git repos) as the single source-of-truth.

The potential downside is that we'll need filesystem watchers. So far I think it can work reliably though: Vite shows that watching all the files of a project works, and we'll only need to watch The Framework's `.the-framework/*` data (of all Git repos).

The follow up question is about Telefunc. How can we use Telefunc to automatically sync the UI with `.the-framework/*` data? @nitedani Ideas?

@suleimansh In then meantime, for the MVP, I guess it's enough if the UI requests the data at load time (no syncing, user has to F5 the page to get fresh data), while the main view is synced via Telefunc Stream.

See also:
- https://github.com/gemstack-land/the-framework/issues/313

---
Source: https://github.com/gemstack-land/the-framework/issues/454
