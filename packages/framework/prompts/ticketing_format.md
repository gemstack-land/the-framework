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
