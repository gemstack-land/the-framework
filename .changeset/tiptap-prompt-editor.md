---
"@gemstack/framework": minor
---

Replace the dashboard's Start-a-run textarea with a rich prompt editor (Tiptap). Type `/` for commands (load a preset, or insert an agent action like `showMultiSelect()`) and `@` for references (the repeated macro tags `<AWAIT>` / `<REVIEW_FILE>` / `<TODO_FILE>` / `<SESSION_NAME>`, and the registered projects — a project mention also adds its repo to the run context). Tokens render as chips but serialize back to the exact plain text the agent already reads, so the run contract is unchanged. Markdown is live (StarterKit shortcuts) and round-trips faithfully, so a loaded preset comes back essentially verbatim with its tags chip-ified.
