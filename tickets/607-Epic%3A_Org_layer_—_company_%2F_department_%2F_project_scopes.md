# Epic: Org layer — company / department / project scopes

> Tracked-but-later (**Phase 2**, post-investors). Do not build before the MVP and the collaboration layer. Captured from team discussion; deferred by consensus.

## Vision

An organization layer so agents work like scoped teammates inside a company:

- Three nested scopes, each with its own knowledge base: **Company** (shared across everyone), **Department** (e.g. Software / Marketing / Design, with its own members, agents, projects, knowledge), and **Project** (lives in a department, shareable on demand).
- Agents are scoped members: a Software agent inherits Company + Software knowledge but cannot see another department's private data. Real access boundaries, not one flat context.
- This is the layer built for companies and teams, and the natural home for a paid tier.

## Open questions / caution

- Do not hard-box agents into fixed roles. This was flagged in discussion as a **security question, not a clearance one**. The scoping above should be expressed as an access/permission model, not rigid role assignments. The exact permission model is TBD.
- Monetization: agreed this is long-term and likely the paid/hosted tier, deferred until after investors + growth.

## Related

- Depends on #606 (collaboration layer) and #605 (daemon + gateway split).
- #462 (tickets/knowledge saved in Git per repo): the per-scope knowledge bases build on this.

---
Source: https://github.com/gemstack-land/gemstack/issues/607
