# [The Framework] Background jobs

Implements:
- Listeners
  - Error in production (Sentry, Cloudfalre, ...) => triggers agent
  - CI is red on `main` (GitHub) => triggers agent
- The [usage max-out idea](https://github.com/gemstack-land/the-framework/pull/287/changes):
  - Check the current usage limit + when the limit resets
    - If usage limit reached (with a configurable margin) => abort, don't do any maintenance
    - Make sure to also check the usage limit of the current default model => use a fallback model if usage limit is reached (with a configurable margin)
  - If there's capacity, then check the latest commits of all The Framework repos that weren't reviewed by the maintenance loop yet => apply the maintenance loop
- Autopilot mode (fully automatic development cycle, including feature requests)
- More?

---
Source: https://github.com/gemstack-land/the-framework/issues/298
