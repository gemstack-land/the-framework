# Ticket format

## tickets/<DATE>_<SLUG>.md

DATE: yyyy-mm-dd
SLUG: succinct kebab-case slug of the ticket title
Body:
```md
priority: low/medium/high/urgent [optional]
topics: [list-of-topics] [optional]

# Ticket title

## TLDR

...

## Why it matters

...

[optional: more info (any heading and format you want)]
```

## tickets/<DATE>_<SLUG>.spike.md

For an existing ticket (e.g. `tickets/2042-01-01_some-ticket.md`), a spike can be created (`tickets/2042-01-01_some-ticket.spike.md`).

Body:
```md
# [Spike] Ticket title

## TLDR

...

## Analysis

...

[optional: more info (any heading and format you want)]
```

Typical spike content:
- High-level overview, for example:
  - What it takes to implement it
  - List all the ways to implement it
  - Potential "laziness" shortcuts
  - Full-fledged implementation VS minimal implementation
  - Open questions
  - ...
- Estimated effort (for each ways to implement it):
  - Human intervention effort: trivial/low/medium/high/very-high
  - Token consumption: time estimate (minutes, hours, or days)

## tickets/<DATE>_<SLUG>.plan.md

For an existing ticket (e.g. `tickets/2042-01-01_some-ticket.md`), a detailed plan can be created (`tickets/2042-01-01_some-ticket.plan.md`).

Body:
```md
# [Plan] Ticket title

## TLDR

...

## Plan

...

## Hard problems [optional]

...

## Variability [optional]

...

[optional: more info (any heading and format you want)]
```

Typical plan content:
- Concrete and detailed plan on how to implement the ticket, for example:
  - Exhaustive list of all aspects (including edge cases)
  - Thorough analysis
  - Overview of code changes
  - ...
- Plan broken down in multiple (sub)plans in case of variability
- Hard problems
  - Exhaustive list of all aspects with low confidence regarding how to solve them (the hard problems), with explanation why
- Variability
  - List all aspects that need to be implemented
  - Give a rating to each aspect (from 0 to 10) following this criteria: is there an obviously optimal way to implement it (10), or is it highly unclear whether it can be implemented in a better way (0)?
  - Explore and suggest alternatives for aspects with a low rating
  - For each aspect that has alternatives: list all alternatives sorted in a sensible order, then ask the user to pick one with showChoices() and AWAIT (one question per aspect, recommending the alternative you'd pick)
