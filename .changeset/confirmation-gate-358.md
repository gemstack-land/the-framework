---
'@gemstack/framework': minor
---

Turn-boundary gate for plan approval (`showMarkdown()` + AWAIT): a build turn that ends with an `await-confirmation` block (the #326 large-scope PLAN flow) now pauses the run with a green Approve and a red Decline button on the dashboard. Approve resumes the build; Decline logs "Plan declined, awaiting user instructions." and stops the run cleanly (like the budget cap), so nothing reviews or improves work the user just declined. Headless runs auto-approve, keeping programmatic runs deterministic. Try it offline with `FRAMEWORK_FAKE_AWAIT=confirmation`.
