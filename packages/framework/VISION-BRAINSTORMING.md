## UI

> [!WARNING]
> This includes brainstorming ideas (long-term vision). **A lot is out-of-scope for the MVP:** we can only implement the MVP-relevant parts.

- **Sidebars**:
  1. [ ] First sidebar (on the left):
     - Three sections: `Overview`, `Projects`, `Queue`
       - `Projects`: shows the list of all projects where The Framework is installed
       - `Queue`: essentially all the `TODO.md` entries of all projects
       - `Overview`: some kind of nice overview of current prompts AI is working on, the queue, and recent projects
  2. [ ] Second sidebar (on the left): shows the latest AI loops/prompts of the currently selected project (the most recently active project if none is selected)
     - In other words: clicking a project => essentially shows `.the-framework/LOGS.md` in the second sidebar
  3. [ ] Third sidebar (on the right)
     - Show arbitrary views (e.g. when AI calls the function `showMarkdown()`, `<Choices>`, ...)
     - Sticky top nav to jump between views (e.g. for jumping between [`PLAN.md` and `TODO.md`](https://github.com/gemstack-land/gemstack/issues/297#issuecomment-4913683778))
- [ ] **Main view**: shows the last loop/prompt of the selected project (similar to https://claude.ai/code).
- [ ] **Installing projects**
  - A repo is activated when it has a `.the-framework/` directory
  - Installation: the user can click on a button "Add project(s)" => user can add a directory of repos, or a single repo
    - When adding a directory: add all child directories that are Git repos
    - Commits an empty `.the-framework/LOGS.md` with commit message `[The Framework] install The Framework`
      - If the Git repo is dirty, then commit the uncommitted changes with a commit message `[The Framework] uncommitted changes`
- [ ] **`<Choices>`**
  - When AI needs the user to choose between a list of options to proceed
  - Ideally, choices always have a recommended choice (if a recommendation is missing, then pick first choice)
  - Click green button `Accept` (or shortcut `Ctrl + Enter`) => accepts (picks the recommended choices)
  - If `[x] autopilot` => auto-accepts after 10 seconds (while the UI says "move mouse to abort countdown")
  - All *sets* of choices (`Choices[]`, not `Choice[]`) are shown *at once* in the right sidebar (no pagination, long vertical scroll instead, with sticky top nav to quick-jump between all the sets of choices)
- [ ] **Global options**
  - `boolean` Autopilot (whether to auto-accept)
  - `boolean` Technical control (expose technical details, e.g. <Choices> for tech stack)
  - `boolean` Eco (fine-grain control over system prompt to save resources)
    - `boolean` Auto planning
    - `boolean` Auto research
    - `boolean` Auto maintenance
  - `boolean` Vanilla (remove all system prompts, fully transparent, same as directly using Claude Code)
- [ ] **Context selector** — multi-select dropdown (to select list of directories)
  - This just adds one line to the system prompt: `Context: [list-of-dirs]`
  - AI always has *access* to all repos (but it doesn't mean it should read all repos, we therefore need a "context selector")
    - When adding repos: "Do you trust this repository? ("You must trust it, otherwise high risk of `[prompt injection](link-that-explains-the-problem)`.")


## Marketing

Open source
State-of-the-art skills and system prompts
