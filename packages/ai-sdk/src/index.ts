// @gemstack/ai-sdk — AI engine

// Attachments
export { DocumentAttachment as Document, ImageAttachment as Image, getMessageText, attachmentsToContentParts } from './attachment.js'

// Types
export type {
  AgentPromptOptions,
  Attachment,
  AiMessage,
  ContentPart,
  AiConfig,
  AiModelConfig,
  AiProviderConfig,
  AiMiddleware,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  BeforeToolCallResult,
  CacheableConfig,
  CacheableMarkers,
  ClientTool,
  ConversationStore,
  ConversationStoreMeta,
  MemoryEntry,
  RemembersOverride,
  RemembersSpec,
  UserMemory,
  FinishReason,
  HasMiddleware,
  HasMemory,
  HasStructuredOutput,
  HasTools,
  MiddlewareConfigResult,
  MiddlewareContext,
  PrepareStepResult,
  ProviderAdapter,
  ProviderFactory,
  ProviderRequestOptions,
  ProviderResponse,
  ServerTool,
  StopCondition,
  Tool,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolCallContext,
  ToolChoice,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
  ToolNeedsApproval,
  ToolResult,
  EmbeddingAdapter,
  EmbeddingResult,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
  RerankingAdapter,
  RerankingOptions,
  RerankingResult,
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  FileContent,
  SubAgentUpdate,
} from './types.js'

// Registry
export { AiRegistry } from './registry.js'

// Providers
export { AnthropicProvider, type AnthropicConfig } from './providers/anthropic.js'
export { OpenAIProvider, OpenAIAdapter, type OpenAIConfig } from './providers/openai.js'
export { GoogleProvider, type GoogleConfig } from './providers/google.js'
export { OllamaProvider, type OllamaConfig } from './providers/ollama.js'
export { DeepSeekProvider, type DeepSeekConfig } from './providers/deepseek.js'
export { XaiProvider, type XaiConfig } from './providers/xai.js'
export { GroqProvider, type GroqConfig } from './providers/groq.js'
export { MistralProvider, type MistralConfig } from './providers/mistral.js'
export { AzureOpenAIProvider, type AzureOpenAIConfig } from './providers/azure.js'
export { CohereProvider, type CohereConfig } from './providers/cohere.js'
export { JinaProvider, type JinaConfig } from './providers/jina.js'
export { ElevenLabsProvider, type ElevenLabsConfig, DEFAULT_TTS_MODEL_ID, DEFAULT_VOICE_ID } from './providers/elevenlabs.js'
export { VoyageProvider, type VoyageConfig, type VoyageEmbedExtras } from './providers/voyage.js'
export { OpenRouterProvider, type OpenRouterConfig } from './providers/openrouter.js'
export { BedrockProvider, type BedrockConfig } from './providers/bedrock.js'

// Tools
export {
  toolDefinition,
  dynamicTool,
  ToolBuilder,
  toolToSchema,
  pauseForClientTools,
  isPauseForClientToolsChunk,
  pauseForApproval,
  isPauseForApprovalChunk,
} from './tool.js'
export type { PauseForClientToolsChunk, PauseForApprovalChunk } from './tool.js'
export { zodToJsonSchema } from './zod-to-json-schema.js'

// Scoped / multi-capability tools — collapse a discriminated union of
// capability branches into one flat function-call schema.
export { scopedTool, capability, flattenCapabilities, ScopedToolError } from './scoped-tool.js'
export type { ScopedToolOptions, ScopedCapability, FlatPlan } from './scoped-tool.js'

// Handoffs
export { handoff, isHandoffTool } from './handoff.js'
export type { HandoffTool, HandoffOptions, HandoffSpec } from './handoff.js'

// Agent
export { Agent, ConversableAgent, agent, stepCountIs, hasToolCall, setConversationStore, setUserMemory, resolveUserMemory } from './agent.js'
export type {
  InvalidToolArgumentsError,
  SubAgentResumeOptions,
  SubAgentResumeRequest,
  SubAgentResumeOutcome,
  SubAgentResumeManyOptions,
  SubAgentResumeManyResult,
  AsToolStreamingOption,
  ChunkProjector,
} from './agent.js'
export { QueuedPromptBuilder } from './queue-job.js'

// Middleware
export { runOnConfig, runOnChunk, runOnBeforeToolCall, runOnAfterToolCall, runSequential, runOnUsage, runOnAbort, runOnError } from './middleware.js'

// Structured Output
export { Output, type OutputWrapper } from './output.js'

// Conversation
export { MemoryConversationStore } from './conversation.js'
export { sanitizeConversation } from './sanitize-conversation.js'
export {
  validateContinuation,
  assertValidContinuation,
  defaultContinuationValidator,
  ContinuationValidationError,
} from './continuation-validation.js'
export type {
  ContinuationValidationResult,
  ContinuationRejectionCode,
  ContinuationValidator,
  ValidateContinuationOptions,
} from './continuation-validation.js'

// User Memory (#A4)
export { MemoryUserMemory, resolveRemembersSpec } from './memory.js'
export type { UserMemoryLookup } from './memory.js'
export { withMemoryInject } from './memory-inject.js'
export type { MemoryInjectOptions } from './memory-inject.js'
export { withMemoryExtract } from './memory-extract.js'
export type { MemoryExtractOptions } from './memory-extract.js'

// Sub-agent run store (asTool streaming + suspend)
export {
  InMemorySubAgentRunStore,
  CachedSubAgentRunStore,
  type SubAgentRunStore,
  type SubAgentRunSnapshot,
  type SubAgentPauseKind,
  type CachedSubAgentRunStoreOptions,
} from './sub-agent-run-store.js'

// Standalone agent run store (top-level stream() client-tool / approval pauses)
export {
  InMemoryAgentRunStore,
  CachedAgentRunStore,
  newAgentRunId,
  type AgentRunStore,
  type AgentRunState,
  type AgentPauseKind,
  type CachedAgentRunStoreOptions,
} from './agent-run-store.js'

// Facade
export { AI } from './facade.js'

// Image Generation
export { ImageGenerator } from './image.js'

// Audio (TTS & STT)
export { AudioGenerator } from './audio.js'
export { Transcription } from './transcription.js'

// Provider Tools
export { WebSearch, WebFetch, CodeExecution } from './provider-tools.js'

// Vercel AI Protocol
export { toVercelDataStream, toVercelResponse } from './vercel-protocol.js'

export {
  toAgentSseStream,
  toAgentSseResponse,
  readAgentStream,
  applyAgentSseEvent,
  newAgentStreamTurn,
} from './agent-sse.js'
export type {
  AgentSseEventName,
  AgentAwaiting,
  AgentSseTextPayload,
  AgentSseToolCallPayload,
  AgentSseToolUpdatePayload,
  AgentSseToolResultPayload,
  AgentSsePendingClientToolsPayload,
  AgentSseApprovalPayload,
  AgentSseHandoffPayload,
  AgentSseCompletePayload,
  AgentSseErrorPayload,
  AgentStreamTurn,
  AgentStreamCallbacks,
} from './agent-sse.js'

// Reranking
export { Reranker } from './rerank.js'

// File Management
export { FileManager } from './files.js'

// Hosted Vector Stores (#B8 Phase 1)
export { VectorStores, VectorStore } from './vector-stores/index.js'
export type {
  VectorStoreAdapter,
  VectorStoreCreateOptions,
  VectorStoreInfo,
  VectorStoreFileInfo,
  VectorStoreAddOptions,
  VectorStoreListOptions,
  VectorStoreList,
  VectorStoreFileList,
} from './types.js'

// File Search agent tool (#B8 Phase 2 — provider-native RAG)
export { fileSearch, isFileSearchTool, FILE_SEARCH_MARKER, FILE_SEARCH_TOOL_NAME, normalizeWhere } from './file-search.js'
export type { FileSearchOptions, FileSearchTool, FileSearchFilter, FileSearchWhereSugar } from './file-search.js'

// Cached Embeddings
export { CachedEmbeddingAdapter } from './cached-embedding.js'

// Similarity Search (#B7 Phase 2 — agent tool wrapping ORM vector primitives)
export { similaritySearch } from './similarity-search.js'
export type {
  SimilaritySearchOptions,
  SimilarityHit,
  SimilaritySearchModel,
  SimilaritySearchQueryBuilder,
} from './similarity-search.js'

// Budget / pricing (#A6 — full pricing catalog + per-user spend caps)
export {
  ModelPricing,
  estimateCost,
  assertKnownModelPricing,
  UnknownModelPricingError,
  BudgetExceededError,
} from './budget/pricing.js'
export type { ModelPriceEntry } from './budget/pricing.js'
export {
  memoryBudgetStorage,
  periodKey,
} from './budget/storage.js'
export type {
  BudgetStorage,
  BudgetPeriod,
  BudgetCheckOptions,
  BudgetCheckResult,
} from './budget/storage.js'
export { withBudget } from './budget/with-budget.js'
export type {
  WithBudgetOptions,
  BudgetCaps,
  BudgetExceededArgs,
} from './budget/with-budget.js'

// Testing
export { AiFake } from './fake.js'
