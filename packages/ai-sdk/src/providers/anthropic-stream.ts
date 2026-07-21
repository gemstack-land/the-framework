import type { StreamChunk } from '../types.js'

/**
 * Cross-event state for Anthropic streaming. The protocol splits prompt and
 * completion token counts across two distinct events; we track the prompt
 * count from `message_start` so the later `message_delta` → `finish` chunk can
 * emit a complete usage object.
 */
export interface AnthropicStreamState {
  lastPromptTokens: number
}

export function newAnthropicStreamState(): AnthropicStreamState {
  return { lastPromptTokens: 0 }
}

/**
 * Map a single decoded Anthropic stream event to zero-or-more `StreamChunk`s.
 * Shared by the native Anthropic adapter and Bedrock, which wraps Anthropic's
 * events 1:1 in `chunk.bytes`.
 *
 * `state` is mutated across calls: `message_start` captures `lastPromptTokens`,
 * the subsequent `message_delta` reads it back. Without this, the `finish`
 * chunk reports `promptTokens: 0`, the agent loop's last-wins aggregation
 * overwrites the correct earlier value, and consumers (billing, withBudget)
 * silently undercharge for streamed calls.
 */
export function* mapAnthropicStreamEvent(
  event: Record<string, any>,
  state: AnthropicStreamState,
): Generator<StreamChunk> {
  if (event['type'] === 'content_block_delta') {
    const delta = event['delta']
    if (delta?.type === 'text_delta') {
      yield { type: 'text-delta', text: delta.text }
    } else if (delta?.type === 'input_json_delta') {
      yield { type: 'tool-call-delta', text: delta.partial_json }
    }
  } else if (event['type'] === 'content_block_start' && event['content_block']?.type === 'tool_use') {
    yield {
      type: 'tool-call-delta',
      toolCall: { id: event['content_block'].id, name: event['content_block'].name },
    }
  } else if (event['type'] === 'message_delta') {
    const completionTokens = event['usage']?.output_tokens ?? 0
    yield {
      type: 'finish',
      finishReason: event['delta']?.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: state.lastPromptTokens,
        completionTokens,
        totalTokens: state.lastPromptTokens + completionTokens,
      },
    }
  } else if (event['type'] === 'message_start' && event['message']?.usage) {
    state.lastPromptTokens = event['message'].usage.input_tokens ?? 0
    // output_tokens at message_start is the SDK's initial counter (~0/1), not
    // the final completion total — don't claim a totalTokens here. The
    // `finish` chunk above carries the authoritative final usage.
    yield {
      type: 'usage',
      usage: {
        promptTokens: state.lastPromptTokens,
        completionTokens: 0,
        totalTokens: state.lastPromptTokens,
      },
    }
  }
}
