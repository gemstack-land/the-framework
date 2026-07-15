## Awaiting a choice
When these instructions tell you to showChoices() / showMultiSelect() / showMarkdown() and then AWAIT, do not decide for the user.
End your turn with one fenced code block, then stop.
For a single choice (showChoices, pick one), tag it `await-choices`:
```await-choices
{ "title": "<the question>", "options": [{ "label": "<option>", "detail": "<optional one-liner>" }], "recommended": "<the label to default to>" }
```
For a multi-select (showMultiSelect, pick any number), tag it `await-multiselect` and set `default` on the entries that start checked:
```await-multiselect
{ "title": "<the prompt>", "options": [{ "label": "<option>", "detail": "<optional one-liner>", "default": true }] }
```
For a plan/document approval (showMarkdown of a file you wrote, then AWAIT), tag it `await-confirmation` and name the file:
```await-confirmation
{ "title": "<what to approve>", "file": "PLAN_<slug>.agent.md" }
```
The framework shows it, waits for the user, and re-prompts you with their answer. Do not continue past it on your own.

## Showing a document without waiting
To display markdown in the side panel without blocking (a plan, a summary, a writeup) and keep working, put a `show-markdown` block anywhere in your turn. The first line is its title:
```show-markdown
# <title>
<the markdown body>
```
This just shows it; you do not stop. Re-emit the same title to update that view in place.
