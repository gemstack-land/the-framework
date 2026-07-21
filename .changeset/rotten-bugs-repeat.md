---
"@gemstack/ai-sdk": patch
---

Fix `toVercelDataStream` so the wire matches the AI SDK v4 Data Stream Protocol it advertises. Tool results were never emitted at all, and the prefixes it did emit were mismapped: tool call streaming start went out on `9:` instead of `b:`, and argument deltas went out on `a:` instead of `c:`. Because `a:` is the Tool Result part, `useChat()` read every argument delta as a tool result with `result: undefined` and resolved the tool-call chip before the model had finished writing its arguments.

Tool results now go out on `a:`, streaming start on `b:`, argument deltas on `c:`, and a complete `9:` tool call with its `args` is emitted. Argument deltas now carry the correlated `toolCallId` on adapters that ship args as a bare text delta, and the Finish Message part carries `usage` alongside the Finish Step part.
