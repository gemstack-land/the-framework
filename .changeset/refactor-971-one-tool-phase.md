---
'@gemstack/ai-sdk': patch
---

Tool calls alongside a handoff now dispatch in parallel like every other batch (#971)

`tool-execution.ts` implemented the tool phase twice, once serial and once parallel, with
every gate written in both copies: unknown-tool, client-tool stop and placeholder, approval
rejected and pending, `onBeforeToolCall` skip/abort/transformArgs, and argument validation.
The `executeMaybeStreaming` pause-detection loop was duplicated near byte-for-byte,
differing only in `yield` versus a push into a buffer.

The copies had already drifted. The handoff branch existed only in the serial path, so
`executeToolPhase` force-downgraded the whole step to serial whenever any call in it was a
handoff. The gate chain is now one function, `decideToolCall()`, that returns a decision
both paths consume, and one shared generator drives execution for both. The parallel path
gained the handoff branch from that, so the downgrade is gone.

The only user-visible change: in a step that mixes ordinary tool calls with a handoff, the
ordinary calls decided before the handoff now run concurrently instead of one after another.
Everything downstream is unchanged. The first handoff in a step still wins, later calls are
still skipped with the same synthetic result rather than executed, and the tool messages are
still emitted in tool-call order with identical content. Apps that need the old ordering can
already opt out with `parallelTools: false`.
