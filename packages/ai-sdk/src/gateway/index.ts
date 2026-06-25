/**
 * `@gemstack/ai-sdk/gateway` — abstract template for normalizing an upstream LLM
 * gateway (its own auth scheme + request/response/SSE envelope) behind the
 * framework's {@link ProviderAdapter} contract.
 *
 * See {@link HttpGatewayAdapter} for when to reach for this versus a `baseUrl`
 * override on an OpenAI/Anthropic-compatible provider.
 */
export {
  HttpGatewayAdapter,
  type GatewayAdapterConfig,
  type GatewayRequestContext,
} from './http-gateway-adapter.js'
export { parseSseStream, type SseEvent } from './sse.js'
