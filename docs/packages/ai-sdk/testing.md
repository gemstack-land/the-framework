# Testing & Evals

`@gemstack/ai-sdk` ships three layers for proving an agent works:

- **`AiFake`** swaps the registered provider with a programmable mock, so you can test agent wiring with no API key and no network.
- **Observers** let you subscribe to agent lifecycle events for tracing and metrics.
- **The eval framework** (`@gemstack/ai-sdk/eval`) runs a suite of input cases plus assertions against real models, to prove the agent does the right thing, not just that it runs.

See also: [Agents](/packages/ai-sdk/agents), [Tools](/packages/ai-sdk/tools), [Providers](/packages/ai-sdk/providers).

## Testing with `AiFake`

`AiFake.fake()` replaces every registered provider with a mock and sets a default model, so your agent code runs unchanged with no real provider. Call `.restore()` afterward to put the real registry back, so tests do not leak between cases.

```ts
import { AiFake } from '@gemstack/ai-sdk'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

const response = await new MyAgent().prompt('Hello')
// response.text === 'Mocked response'

fake.restore()
```

`respondWith(text)` returns the same text for every call. The default before you set anything is `'fake response'`.

### Scripting a multi-step loop

When the agent loops (the model returns tool calls, then text, then more tool calls), script each step with `respondWithSequence(...)`. Step `N` answers the agent's `N`th provider call:

```ts
fake.respondWithSequence([
  { toolCalls: [{ id: 't1', name: 'lookup', arguments: { id: 42 } }] },
  { text: 'The answer is 42.' },
])
```

When a step sets `toolCalls`, the `finishReason` defaults to `'tool_calls'`; a text-only step defaults to `'stop'`. Once the sequence is exhausted, later calls fall back to the `respondWith` default.

### Forcing failures

`failOnStep(stepIndex, error)` throws on a specific iteration, to exercise failover and error paths. It is independent of the response sequence, so the order in which you call them does not matter:

```ts
fake.respondWithSequence([
  { toolCalls: [{ id: 't1', name: 'lookup', arguments: {} }] },
  { text: 'recovered' },
])
fake.failOnStep(0, new Error('Rate limited'))   // first call throws; second succeeds
```

### Faking the other capabilities

The fake also covers the non-chat surfaces, each with a matching `respondWith*`:

| Method | Fakes |
|---|---|
| `respondWithImage(base64)` | image generation |
| `respondWithAudio(buffer)` | text-to-speech |
| `respondWithTranscription(text)` | speech-to-text |
| `respondWithEmbedding(vectors)` | embeddings |
| `respondWithRanking(results)` | reranking |
| `respondWithFileUpload(result)` | file uploads |
| `respondWithFileSearchResults(opts)` | hosted file-search results |

### Asserting on what was sent

After a run, assert on what the agent actually sent the provider:

```ts
const fake = AiFake.fake()
fake.respondWith('hi')

await new MyAgent().prompt('Hello there')

fake.assertPrompted(input => input.includes('Hello'))
fake.restore()
```

The assertion helpers each take an optional predicate: `assertPrompted`, `assertNothingPrompted`, `assertImageGenerated`, `assertAudioGenerated`, `assertTranscribed`, `assertEmbedded`, `assertReranked`, and `assertFileUploaded`.

To make stray prompts a hard error (no ambient `respondWith` default), chain `preventStrayPrompts()` and script every expected call explicitly:

```ts
const fake = AiFake.fake().preventStrayPrompts()
fake.respondWithSequence([{ text: 'expected reply' }])
// any call beyond the scripted sequence throws instead of returning a default
```

## Observability

Subscribe to agent lifecycle events through the observer registry on the `@gemstack/ai-sdk/observers` subpath. This is the same surface a tracing or metrics collector hooks into:

```ts
import { aiObservers } from '@gemstack/ai-sdk/observers'

const unsubscribe = aiObservers.subscribe(event => {
  if (event.kind === 'agent.step.completed') {
    console.log(`step ${event.iteration}: ${event.tokens.total} cumulative tokens`)
  }
  if (event.kind === 'agent.completed') {
    console.log(`done in ${event.duration}ms, ${event.steps.length} steps`)
  }
})
```

Event kinds:

- **`agent.step.completed`** fires after each loop iteration, with that step's tools called, finish reason, and cumulative usage. Useful for streaming progress to a UI without waiting for the full run.
- **`agent.completed`** fires once after a successful run, with the full step history and final usage.
- **`agent.failed`** fires once, with `error` set, when the run throws or aborts.
- **`agent.eval.completed`** fires per eval case (see below), so collectors can aggregate pass-rate over time.

Each step's `toolCalls[]` carries a `duration` field (wall-clock milliseconds spent in the tool handler), so you can attribute latency to specific tools.

## Evals against real models

`AiFake` proves the wiring works. **Evals** prove the agent does the right thing on real models. Define a suite of input cases and assertions, then run it. Eval suites use the same `Agent` instances as your app, so there is one source of truth.

```ts
// evals/support-agent.eval.ts
import { evalSuite, llmJudge, exactMatch, regex } from '@gemstack/ai-sdk/eval'
import { SupportAgent } from '../app/Agents/SupportAgent.js'

export default evalSuite('SupportAgent', {
  agent: () => new SupportAgent(),
  cases: [
    { name: 'password reset', input: 'How do I reset my password?',
      assert: llmJudge('mentions a password reset link or email') },
    { name: 'price', input: 'How much?',
      assert: exactMatch('$99/month') },
    { name: 'support email', input: 'Contact?',
      assert: regex(/support@example\.com/) },
  ],
})
```

### Running a suite programmatically

`evalSuite(...)` returns a suite object; run it with `runSuite(suite)`. It resolves to a `SuiteReport` with per-case pass/fail, score, tokens, cost, and duration. Pair it with a reporter:

```ts
import { runSuite, reportConsole, reportJson, reportHtml } from '@gemstack/ai-sdk/eval'
import suite from './evals/support-agent.eval.js'

const report = await runSuite(suite)

reportConsole(report)                 // human-readable summary to console
const envelope = reportJson(report)   // CI-friendly JSON envelope
const html     = reportHtml(report)   // self-contained HTML string
```

Drive your own pass/fail gate off the report (for example, exit non-zero when `report.failed > 0`) so evals can run in CI without any framework CLI. `reportConsole` returns the report unchanged, so you can chain it inline.

### Built-in metrics

An assertion is a `Metric`: `(response, ctx) => MetricResult`, where `MetricResult` is `{ pass, score?, reason? }`. Sync or async both work. The built-ins:

- `exactMatch(string)` and `regex(RegExp)` are surface checks on `response.text`.
- `llmJudge(criterion, opts?)` uses a small-model judge for fuzzy "did the answer mention X?" assertions.
- `jsonShape(zodSchema)` is a strict structural assertion: it strips code fences and runs zod `safeParse`, surfacing the failing path.
- `semanticMatch(reference, opts?)` embeds the reference and response and compares by cosine similarity against `opts.threshold` (default `0.85`). Requires a registered provider with embeddings.
- `tokenCost(threshold)` passes when `response.usage.totalTokens <= threshold`, to catch prompt-size regressions.
- `compose(...metrics)` runs metrics in order with first-failure short-circuit, for example `compose(jsonShape(Schema), tokenCost(800))`.

User metrics are first-class: any `(response, ctx) => MetricResult` qualifies. The `ctx` carries the case `input` and `caseName` so a custom metric can log or branch on them.

### Eval observability

`runSuite` emits an `agent.eval.completed` observer event after every case (including skipped ones), so a metrics collector subscribed to `aiObservers` can aggregate pass-rate per `(suite, case)` over time, exactly like the lifecycle events above.

> The `evalSuite` / `runSuite` / metrics / reporters API documented here is the programmatic engine surface. The Rudder framework adds an `ai:eval` CLI on top of it for record/replay and discovery; that command lives in `@rudderjs/ai`, not in this engine.
