# Task 001: add tags to notes

A representative full-stack feature: it touches the data model, the HTTP contract, and the UI. The same prompt is given to the agent on both apps.

## Agent prompt (verbatim, given on both apps)

> Add tagging to notes. A note can have zero or more tags (short text labels). Update the create form so a user can enter comma-separated tags when creating a note. Show each note's tags in the list and on the detail page. Add the ability to list notes filtered to a single tag. Keep the existing HTTP contract working and extend it as described in the acceptance criteria.

## Required contract changes

- `Note` gains `tags: string[]` (empty array when none).
- `POST /api/notes` accepts an optional `tags: string[]` in the body and persists it.
- `GET /api/notes` accepts an optional `?tag=<t>` query param; when present, only notes carrying that exact tag are returned.
- `GET /api/notes/:id` includes `tags`.

## Acceptance criteria (checked by `tasks/task-001-tags/accept.mjs`)

1. Log in as the seeded user.
2. Create note A with `tags: ["work", "urgent"]`.
3. Create note B with `tags: ["home"]`.
4. `GET /api/notes?tag=work` returns A and not B.
5. `GET /api/notes?tag=home` returns B and not A.
6. `GET /api/notes/<A.id>` includes `tags` containing `work` and `urgent`.
7. `GET /api/notes` (no filter) returns both, each with a `tags` array.

The script exits `0` only when all checks pass. Any non-zero exit is a fail.

## Guardrails

- Hard timeout: 30 minutes wall clock.
- Max interventions before DNF: 5.
- A UI must exist for entering and displaying tags (spot-checked by the human), but the automated gate is the contract above.
