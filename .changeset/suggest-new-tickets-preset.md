---
"@gemstack/framework": minor
---

Add the "Suggest new tickets" preset (#462), the Agentic PM ideation prompt. Like the other presets it prefills the dashboard editor and runs as a `prompt` kind. Per #674 the prompt is a single line, "Suggest new tickets": the run-start context fragment (#683) already points the agent at the existing `tickets/**.md` and the `.the-framework/ticketing-format.md` spec (#684), so it does not need to re-teach the ticket format or spell out the flow. Per the settled #624 model the proposal is just a PR: merging accepts the tickets, closing rejects them.
