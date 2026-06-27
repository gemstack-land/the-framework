# Build a Multi-Agent App

[Your First Agent](/guide/first-agent) ended with a single agent answering one prompt. Real work rarely fits one prompt: a research question fans out into several lines of inquiry that each want their own tools, a shared house style, and someone to plan the work and stitch the findings back together.

This tutorial builds that app, a small research assistant, by composing three GemStack packages:

- [`@gemstack/ai-sdk`](/packages/ai-sdk/agents) for tools and the agent loop,
- [`@gemstack/ai-skills`](/packages/ai-skills) to load a portable `SKILL.md` skill onto a worker,
- [`@gemstack/ai-autopilot`](/packages/ai-autopilot) to plan a task into subtasks, dispatch them to workers, and synthesize the result.

By the end you will have a `Supervisor` that breaks a research question into subtasks, runs each on a skill-equipped worker agent, and combines the answers. We finish with a short note on exposing the whole thing over MCP.

If you have not registered a provider yet, do that first (see [Installation](/guide/installation)).

## Register a provider

Every example assumes a default provider registered once at startup:

```ts
import { AiRegistry, AnthropicProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }))
AiRegistry.setDefault('anthropic/claude-sonnet-4-6')
```

With a default model set, agents do not need to declare one.

## Step 1: two tools the worker can call

A research worker needs to reach the web. We give it two tools with `toolDefinition(...)`: one to search, one to fetch a page. Each declares its input with Zod and attaches a `.server()` handler that the agent calls (see [Tools](/packages/ai-sdk/tools)). Swap the stubbed bodies for a real search API and HTTP client.

```ts
import { toolDefinition } from '@gemstack/ai-sdk'
import { z } from 'zod'

export const searchWeb = toolDefinition({
  name:        'search_web',
  description: 'Search the web and return the top matching result snippets',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    limit: z.number().int().min(1).max(10).default(5),
  }),
}).server(async ({ query, limit }) => {
  // Call your real search provider here.
  return await search(query, limit)   // -> [{ title, url, snippet }, ...]
})

export const fetchPage = toolDefinition({
  name:        'fetch_page',
  description: 'Fetch a URL and return its readable text content',
  inputSchema: z.object({ url: z.string().url() }),
}).server(async ({ url }) => {
  const res = await fetch(url)
  return await res.text()
})
```

The agent decides when to call each tool, validates the arguments against `inputSchema` before your handler runs, and feeds the result back to the model on the next step.

## Step 2: a skill for house style

Every worker should cite its sources the same way, and that convention should travel with the agent rather than being copy-pasted into each system prompt. That is exactly what a skill is: a portable folder of instructions (and optionally tools and resources) you compose onto an agent on demand.

Create `skills/citations/SKILL.md`. The YAML frontmatter is the manifest; the markdown body becomes extra system-prompt text:

```markdown
---
name: citations
description: Cite every claim with a source URL and never invent sources
trigger: answering a research question that draws on web sources
---

# Citations

When you state a fact drawn from a source, cite it inline with the page URL in
parentheses, like (https://example.com/article). Only cite pages you actually
fetched with `fetch_page`. If you could not verify a claim, say so plainly
instead of guessing. End your answer with a "Sources" list of the URLs you used.
```

This skill is instructions-only, so there is no build step to worry about. (A skill that ships tools co-locates them in a `tools.ts` that the loader imports from its compiled output; see the [compiled-output caveat](/packages/ai-skills) when you go that far.)

Load it once at module init, since loading is async and the agent hooks are synchronous:

```ts
import { loadSkill } from '@gemstack/ai-skills'

const citations = await loadSkill('./skills/citations')
```

## Step 3: the worker agent

The worker is a `SkillfulAgent`. You declare your own identity in `baseInstructions()` and your own tools in `baseTools()`; the skills listed in `skills()` are merged in, with your own declarations winning on any name collision. Because research is multi-step (search, fetch, read, repeat), we give it a stop condition with `stepCountIs(...)`.

```ts
import { SkillfulAgent } from '@gemstack/ai-skills'
import { stepCountIs } from '@gemstack/ai-sdk'

class ResearchWorker extends SkillfulAgent {
  baseInstructions() {
    return 'You research a focused question using the web tools, then answer concisely.'
  }
  skills()    { return [citations] }          // adds the citation house style
  baseTools() { return [searchWeb, fetchPage] }
  stopWhen()  { return stepCountIs(6) }        // up to 6 tool-calling rounds
}
```

Override the `base*` hooks, not `instructions()` / `tools()`: those are sealed on `SkillfulAgent` and do the merge for you. Overriding them directly would drop the skill composition.

You can run this worker on its own to sanity-check it before wiring up the supervisor:

```ts
const probe = await new ResearchWorker().prompt(
  'What problem did the original Transformer paper set out to solve?',
)
console.log(probe.text)   // answer, with a Sources list, thanks to the skill
```

## Step 4: plan, dispatch, synthesize

Now the orchestration. A `Supervisor` takes three stages: a `plan` that decomposes the task into subtasks, the `workers` that run them, and a `synthesize` that combines the results. The planner and synthesizer are themselves ai-sdk agents, adapted with `agentPlanner(...)` and `agentSynthesizer(...)`.

```ts
import { Supervisor, agentPlanner, agentSynthesizer } from '@gemstack/ai-autopilot'
import { agent } from '@gemstack/ai-sdk'

const planner = agent(
  'You break a research question into a few independent sub-questions that can be researched in parallel.',
)

const editor = agent(
  'You combine several researched answers into one coherent, well-cited brief. Preserve every source URL.',
)

const supervisor = new Supervisor({
  plan:        agentPlanner(planner),          // LLM decomposition into subtasks
  workers:     new ResearchWorker(),           // every subtask runs on this worker
  synthesize:  agentSynthesizer(editor),       // LLM synthesis of the results
  concurrency: 3,                              // up to 3 workers in flight at once
  maxSubtasks: 5,                              // hard cap; a longer plan is trimmed
  budget:      { maxTotalTokens: 200_000 },    // stop dispatching past this spend
  onEvent:     (e) => console.log(e.type),     // 'plan', 'dispatch-start', ...
})
```

`workers` here is a single agent, so each subtask runs on a fresh `ResearchWorker` prompt. When you want different subtasks handled by different specialists, pass a `Record<string, Agent>` instead and let the planner set each `subtask.worker` to route between them.

## Step 5: run it

```ts
const run = await supervisor.run(
  'How did the Transformer architecture change machine translation, and what came after it?',
)

console.log(run.text)          // the synthesized, cited brief
console.log(run.plan)          // the subtasks that were executed
console.log(run.results)       // one result per subtask: { text, ok, error?, usage }
console.log(run.usage)         // aggregate token usage across dispatched subtasks
console.log(run.stoppedEarly)  // true if a guardrail trimmed or halted the work
```

`run()` resolves to a `SupervisorRun`. A few properties worth leaning on:

- **`run.results`** is one entry per dispatched subtask, in plan order. A worker that throws becomes an `ok: false` result; its siblings still run, so one failed line of inquiry does not sink the whole report.
- **`run.usage`** aggregates token usage across the dispatched workers. (Planning and synthesis spend are not counted: those contracts return data, not usage.)
- **`run.stoppedEarly`** tells you a guardrail (the `maxSubtasks` cap or the token `budget`) cut the work short, so you can flag a partial answer.

That is the whole app: tools give a worker hands, a skill gives it a house style, and the supervisor plans the work, fans it out, and reassembles it.

## Optional: expose it over MCP

Once the supervisor works, you can publish it as a Model Context Protocol server so other agents and MCP-aware clients can call it as a tool. Wrap the run in a server tool and serve it with [`@gemstack/ai-mcp`](/packages/ai-mcp); the worker's own tools stay internal, and callers see one `research` capability. See [/packages/ai-mcp](/packages/ai-mcp) for the server surface and transport options.

## See also

- [Tools](/packages/ai-sdk/tools) - `toolDefinition(...).server(...)`, streaming, approval, and scoped tools.
- [Running agents](/packages/ai-sdk/agents) - the agent loop, stop conditions, sub-agents, and suspend/resume.
- [`@gemstack/ai-skills`](/packages/ai-skills) - authoring, loading, and composing `SKILL.md` skills.
- [`@gemstack/ai-autopilot`](/packages/ai-autopilot) - the `Supervisor` topology and its guardrails.
- [`@gemstack/ai-mcp`](/packages/ai-mcp) - expose agents and tools over the Model Context Protocol.
