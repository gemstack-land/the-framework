---
"@gemstack/framework": minor
---

Add the [UX] preset (#472): a direct, interactive usability review of a target (defaults to `this PR`), shipped alongside [Research], [Readability], [Maintainability], and [Security audit]. It enumerates every finding as a categorized, reference-numbered list of choices via `showChoices()`, stops for the user to accept proposals, then works on the accepted ones. Available as a dashboard Start-a-run button and exported as `renderUxPrompt`.
