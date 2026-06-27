# @gemstack/ai-skills

Portable capability bundles for [`@gemstack/ai-sdk`](/packages/ai-sdk/) agents. A **skill** is a shippable folder (instructions, tools, and reference files) that you compose onto an `Agent` on demand. It mirrors the Anthropic Agent Skills shape: a skill authored for Claude loads here, and a GemStack skill ships as a plain folder.

```bash
pnpm add @gemstack/ai-skills @gemstack/ai-sdk
```

## What a skill is

A skill is a directory with one required file and two optional pieces:

```
my-skill/
  SKILL.md        # YAML frontmatter (name, description, trigger, ...) + markdown instructions
  tools.ts        # optional: exports @gemstack/ai-sdk tool() objects (loaded compiled, see caveat)
  resources/      # optional: reference files
```

The skill's instructions become extra system-prompt text, its tools become extra agent tools, and its resources travel alongside as reference material. Skills augment an agent; the agent's own declarations stay authoritative.

## The skill manifest

`SKILL.md` is markdown with a YAML frontmatter block, the same convention `@gemstack/ai-sdk` ships in `boost/skills`:

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

The frontmatter is validated into a `SkillManifest`:

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Unique skill id (kebab-case by convention, e.g. `pdf-forms`). |
| `description` | yes | One-line summary, used to decide relevance during discovery. |
| `trigger` | no | Natural-language cue for when to load the skill (progressive disclosure). |
| `skip` | no | When NOT to load it (points at a sibling skill instead). |
| `appliesTo` | no | Free-form hints (package names / globs); documents intent, not enforced. |
| `license` | no | SPDX license id. |
| `metadata` | no | Arbitrary author metadata, passed through untouched. |

`parseSkillManifest(source)` splits a `SKILL.md` string into its validated `{ manifest, instructions }`; a malformed frontmatter throws a `SkillManifestError`.

## Authoring `tools.ts`

A co-located `tools.ts` exports the skill's tools as plain `@gemstack/ai-sdk` `tool()` objects, so there is one tool API across the framework (see [tools](/packages/ai-sdk/tools)):

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

> **Compiled-output caveat.** The loader imports the skill's tools module at runtime, so it resolves the *compiled* output (`tools.js` / `tools.mjs` / `tools.cjs`), not `tools.ts`. Author in TypeScript and build the skill folder, or ship the compiled file alongside `SKILL.md`. The `SKILL.md` instructions and `resources/` stay portable as-is; only the typed tools module needs a build step.

## Composing skills onto an agent

The ergonomic path is `SkillfulAgent`. You declare your base identity and own tools in the `base*` hooks, and list the skills in `skills()`; skills augment, your own declarations win:

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

`SkillfulAgent` exposes four authoring hooks:

| Hook | Returns | Notes |
|---|---|---|
| `baseInstructions()` | `string` | Your agent's identity. Skill instructions are appended after it. Required. |
| `skills()` | `LoadedSkill[]` | The skills composed onto this agent. Defaults to `[]`. |
| `baseTools()` | `AnyTool[]` | Your own tools, authoritative on a name collision with a skill tool. |
| `baseMiddleware()` | `AiMiddleware[]` | Your own middleware, runs before any skill-contributed middleware. |

> **Override the `base*` hooks, not `instructions()` / `tools()` / `middleware()`.** Those three are sealed finals on `SkillfulAgent`: they merge your `base*` declarations with the skills. Overriding them directly drops the skill composition.

Because loading a skill is async (file IO plus importing the tools module) and these hooks are synchronous, load skills once at module init and return the already-loaded objects from `skills()`.

### Low-level composition

If you can't extend `SkillfulAgent` (you use the anonymous `agent()` factory, or already extend another base), the same merge is available as plain functions, `composeInstructions` / `composeTools` / `composeMiddleware`:

```ts
import { Agent } from '@gemstack/ai-sdk'
import { composeInstructions, composeTools } from '@gemstack/ai-skills'

const skills = [refunds]

class SupportAgent extends Agent {
  instructions() { return composeInstructions('You are a support agent.', skills) }
  tools()        { return composeTools([escalateTool], skills) }
}
```

`SkillfulAgent` is sugar over these. See [agents](/packages/ai-sdk/agents) for the underlying `Agent` base.

## Loading skills

`loadSkill(dir, opts?)` reads a skill directory and returns a `LoadedSkill` with its parts ready to compose:

```ts
import { loadSkill } from '@gemstack/ai-skills'

const refunds = await loadSkill('./skills/refunds')
refunds.instructions   // markdown body (string)
refunds.tools          // ai-sdk tool() objects
refunds.resources      // [{ name, path }, ...]
```

`loadSkills(dirs)` loads several at once. `LoadSkillOptions` includes `loadTools: false` to load instructions and resources without importing (and therefore running) the tools module, and `toolsFile` to point at a non-default tools filename.

## Discovery (progressive disclosure)

`SkillRegistry` indexes skills by their cheap frontmatter and loads a skill's full body plus tools only when you ask for it, so you can index hundreds of skills and pay for only the ones you compose:

```ts
import { SkillRegistry } from '@gemstack/ai-skills'

const registry = new SkillRegistry()
await registry.discover('./skills')        // reads frontmatter only, runs no skill code
registry.list()                             // [{ manifest, dir }, ...]

const refunds = await registry.load('refunds')   // now imports the compiled tools module
```

A malformed or unreadable `SKILL.md` is skipped rather than failing the whole scan; pass `discover(root, { onError })` to observe what was skipped.

## Trust model

A skill is code you install or author, like a Vite or ESLint plugin: **loading it runs its code** (the tools module). There is no in-process sandbox (Node's `vm` is not a security boundary). The package keeps the boundary honest instead of pretending to enforce it:

- **No auto-loading of untrusted directories.** You pass explicit paths to `loadSkill` / `discover`; nothing is scanned implicitly.
- **Surface before compose.** `discover()` reads only frontmatter (no code runs). `loadSkill(dir, { loadTools: false })` loads instructions and resources without importing the tools module. `surface(skill)` returns a `SkillSurface` (instructions size, tool names, resource names) so you can inspect before attaching; `surfaceAll(skills)` does the set.
- **The risky moment stays gated.** Skill tools are ordinary `ai-sdk` tools, so tool execution still flows through the agent's existing approval / middleware flow.

If you need real isolation, run the app under OS or container isolation, and only load skills from sources you trust.

## License

MIT
