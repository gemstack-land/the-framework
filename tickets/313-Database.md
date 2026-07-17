# Database

## Project DB

> [!NOTE]
> This includes brainstorming ideas (long-term vision). **A lot is out-of-scope for the MVP:** we can only implement the MVP-relevant parts.

I suggest:
- `.the-framework/LOGS.md` contains the list of AI loops/prompts that were run via The Framework
  - We therefore don't need any real database, the `.the-framework/` directory *is* the database (it isn't `.gitignore` so it's persisted)
  - A log entry can be a loop or a standalone prompt
    - A loop is a list of standalone prompts
  - Each log entry contains the Claude Code session ID (with a link such as `https://claude.ai/code/session_01MU13ncNmLi5rz2xySmm5rZ`, possible thanks to Claude's [Remote Control](https://code.claude.com/docs/en/remote-control))
  - We can very effeciently crawl repo files using `$ git ls-files`.
    - That's [what Vike does](https://github.com/vikejs/vike/blob/8a6511d506a8db32f05944646d52f711eaa1682f/packages/vike/src/node/vite/shared/resolveVikeConfigInternal/crawlPlusFilePaths.ts#L76) and is has been working great. Note that it also lists untracked files.
- Commit messages authored by The Framework contain data.
  - For example, if the commit introduces changes that require refactoring, then `TO-DO/maintenance` is appended:
    ```
    [The Framework] Commit message

    TO-DO/maintenance
    ```
    > E.g. because the PR introduced a bug fix using that applies minimal changes in order to make reviewing easier, but requires refactoring to be clean.

## User DB

A special Git repo named `my-framework` (convention, but the user can save the `my-framework/` directory anywhere) that holds user-specific settings.


## See also

- https://github.com/gemstack-land/gemstack/issues/454

---
Source: https://github.com/gemstack-land/gemstack/issues/313
