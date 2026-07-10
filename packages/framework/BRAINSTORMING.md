## UI

Toggles:
- [] Autopilot (whether to auto-accept)
- [] Technical control (expose technical details, e.g. <Choices> for tech stack)
- [] Eco (fine-grain control over system prompt to save resources)
  - [] Auto planning
  - [] Auto research
  - [] Auto maintenance
- [] Vanilla (remove all system prompts, fully transparent, same as directly using Claude Code)

Dropdowns:
- Context selector (a list of selected directories)
  - This just adds one line to the system prompt: `Context: [list-of-dirs]`
  - AI always has *access* to all repos (doesn't mean it should actually read all repos, we therefore need a context selector)
    - When adding repos: "Do you trust this repository? ("You must trust it, otherwise high risk of [prompt injection](link-that-explains-the-problem).")


## Marketing

Open source
State-of-the-art skills and system prompts
