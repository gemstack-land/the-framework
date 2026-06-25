# @gemstack/ai-skills

Portable capability bundles for [`@gemstack/ai-sdk`](https://github.com/gemstack-land/gemstack/tree/main/packages/ai-sdk) agents. A **skill** is a shippable folder — instructions + tools + resources — that you compose onto an `Agent` on demand. This mirrors the [Anthropic Agent Skills](https://www.anthropic.com/news/agent-skills) shape: a skill authored for Claude loads here, and a gemstack skill ships as a plain folder.

```
my-skill/
  SKILL.md        # YAML frontmatter (name, description, trigger, ...) + markdown instructions
  tools.ts        # optional: exports ai-sdk tool() objects
  resources/      # optional: reference files
```

## Installation

```bash
pnpm add @gemstack/ai-skills @gemstack/ai-sdk
```

## The skill manifest

`SKILL.md` is markdown with a YAML frontmatter block — the same convention `@gemstack/ai-sdk` ships in `boost/skills`:

```markdown
---
name: refunds
description: Issue and look up customer refunds
trigger: handling a refund request or refund status question
metadata:
  author: acme
---

# Refunds

When a customer asks for a refund, look up the order first, then issue the
refund with the `issue_refund` tool. Never refund more than the order total.
```

A co-located `tools.ts` exports the skill's tools as plain `@gemstack/ai-sdk` `tool()` objects — one tool API across the framework:

```ts
import { toolDefinition } from '@gemstack/ai-sdk'
import { z } from 'zod'

export const issueRefund = toolDefinition({
  name: 'issue_refund',
  description: 'Issue a refund for an order',
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
}).server(async ({ orderId, amount }) => {
  return await refunds.create(orderId, amount)
})
```

## Composing skills onto an agent

The ergonomic path is `SkillfulAgent`. You declare your base identity and own tools, and list the skills — skills augment, your own declarations win:

```ts
import { loadSkill, SkillfulAgent } from '@gemstack/ai-skills'

const refunds = await loadSkill('./skills/refunds')

class SupportAgent extends SkillfulAgent {
  baseInstructions() { return 'You are a friendly support agent.' }
  skills()           { return [refunds] }
  baseTools()        { return [escalateTool] }   // wins over a same-named skill tool
}

const reply = await new SupportAgent().prompt('I want a refund for order #123')
```

> Override the `base*` hooks, **not** `instructions()` / `tools()` / `middleware()` — those are sealed finals that merge your declarations with the skills.

### Low-level composition

If you can't extend `SkillfulAgent` (e.g. you use the anonymous `agent()` factory, or already extend another base), the same merge is available as plain functions:

```ts
import { Agent } from '@gemstack/ai-sdk'
import { composeInstructions, composeTools } from '@gemstack/ai-skills'

const skills = [refunds]

class SupportAgent extends Agent {
  instructions() { return composeInstructions('You are a support agent.', skills) }
  tools()        { return composeTools([escalateTool], skills) }
}
```

`SkillfulAgent` is sugar over these.

## Discovery (progressive disclosure)

`SkillRegistry` indexes skills by their cheap frontmatter and loads a skill's full body + tools only when you ask for it — so you can index hundreds of skills and pay for only the ones you compose:

```ts
import { SkillRegistry } from '@gemstack/ai-skills'

const registry = new SkillRegistry()
await registry.discover('./skills')        // reads frontmatter only, runs no skill code
registry.list()                             // [{ manifest, dir }, ...]

const refunds = await registry.load('refunds')   // now imports tools.ts
```

## Trust model

A skill is code you install or author, like a Vite or ESLint plugin: **loading it runs its code** (the tools module). There is no in-process sandbox — Node's `vm` is not a security boundary. The package keeps the boundary honest instead of pretending to enforce it:

- **No auto-loading of untrusted directories.** You pass explicit paths to `loadSkill` / `discover`; nothing is scanned implicitly.
- **Surface before compose.** `discover()` reads only frontmatter (no code runs). `loadSkill(dir, { loadTools: false })` loads instructions + resources without importing the tools module. `surface(skill)` reports a skill's instructions size, tool names, and resources so you can inspect before attaching.
- **The risky moment stays gated.** Skill tools are ordinary `ai-sdk` tools, so tool execution still flows through the agent's existing approval / middleware flow.

If you need real isolation, run the app under OS/container isolation. Only load skills from sources you trust.

## License

MIT
