## CLI

I suggest that running `$ framework` does the following:
- [x] Ensure The background process that runs the localhost dashboard (e.g. `localhost:4200`) is running
- [ ] Runs [background jobs](https://github.com/gemstack-land/gemstack/issues/298)
- [x] Prints the list of commands (just convenience commands like `framework run [prompt]`, `framework logs`, ... — not important since the UI already implements all features)
- [ ] Prints the CLI version
  - [Only if trivial to implement] Show whether the version is up-to-date (by using `$ npm info`).
    - Should be async (show static info first, then await npm server and show "up-to-date" label)
    - The CLI regularly auto-updates itself
    - Also show `(✅ auto-update enabled)`.

## Database

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

## UI

- Toggles
  - [] Autopilot (whether to auto-accept)
  - [] Technical control (expose technical details, e.g. <Choices> for tech stack)
  - [] Eco (fine-grain control over system prompt to save resources)
    - [] Auto planning
    - [] Auto research
    - [] Auto maintenance
  - [] Vanilla (remove all system prompts, fully transparent, same as directly using Claude Code)
- Dropdowns
  - Context selector (a list of selected directories)
    - This just adds one line to the system prompt: `Context: [list-of-dirs]`
    - AI always has *access* to all repos (doesn't mean it should actually read all repos, we therefore need a context selector)
      - When adding repos: "Do you trust this repository? ("You must trust it, otherwise high risk of [prompt injection](link-that-explains-the-problem).")
- Three sidebars:
  1. First sidebar (on the left):
     - Three sections: `Overview`, `Projects`, `Queue`
       - `Projects`: shows the list of all projects where The Framework is activated
         - A project can be a repo, or a package inside a monorepo (but let's skip monorepo support if it's complex)
       - `Queue`: essentially all the `TODO.md` entries of all projects
       - `Overview`: some kind of nice overview of current prompts AI is working on, the queue, and recent projects
  2. Second sidebar (on the left): shows the latest AI loops/prompts run via The Framework of the currently selected project (the most recently active project if none is selected)
     - In other words: clicking a project => essentially shows `.the-framework/LOGS.md` in the second sidebar
  3. Thrid sidebar (on the right)
     - Show arbitrary views (e.g. when AI calls the function `showMarkdown()`)
     - Show `<Choices>`
     - Stick top nav to jump between views (e.g. for jumping between files [like `PLAN.md` and `TODO.md`](https://github.com/gemstack-land/gemstack/issues/297#issuecomment-4913683778))
- Main view: shows the last loop/prompt of the selected project (similar to https://claude.ai/code).
- A project is activated when it has a `.the-framework/` directory
  - Installation: the user can click on a button "Add projects" => user can add a directory of repos, or a single repo
    - When adding a directory: we add all child directories (non-recursively) that are Git repos
    - Commits an empty `.the-framework/LOGS.md` with commit message `[The Framework] install The Framework`
      - If the Git repo is dirty, then commit the uncommitted changes with a commit message `[The Framework] uncommitted changes`
    - If easy to implement: support monorepos (project = package in monorepo)
- `<Choices>`
  - Ideally, choices always have a recommended choice (if a recommendation is missing, then pick first choice)
  - Click green button `Accept` (or shortcut `Ctrl + Enter`) => accepts (picks the recommended choices)
  - If `[x] autopilot` => auto-accepts after 10 seconds (while the UI says "move mouse to abort countdown")
  - All choices are shown *at once* in the right sidebar (no pagination, scroll instead, with sticky top nav to quick-jump between choices)


## Marketing

Open source
State-of-the-art skills and system prompts
