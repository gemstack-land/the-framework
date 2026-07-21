import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  ImageGenerationAdapter,
  TextToSpeechAdapter,
  SpeechToTextAdapter,
  FileAdapter,
  VectorStoreAdapter,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'
import { OpenAIAdapter } from './chat.js'
import { OpenAIEmbeddingAdapter } from './embeddings.js'
import { OpenAIImageAdapter } from './images.js'
import { OpenAITtsAdapter } from './tts.js'
import { OpenAISttAdapter } from './stt.js'
import { OpenAIFileAdapter } from './files.js'
import { OpenAIVectorStoreAdapter } from './vector-store.js'

export class OpenAIProvider implements ProviderFactory {
  readonly name = 'openai'
  private readonly config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(this.config, model)
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new OpenAIEmbeddingAdapter(this.config, model)
  }

  createImage(model: string): ImageGenerationAdapter {
    return new OpenAIImageAdapter(this.config, model)
  }

  createTts(model: string): TextToSpeechAdapter {
    return new OpenAITtsAdapter(this.config, model)
  }

  createStt(model: string): SpeechToTextAdapter {
    return new OpenAISttAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new OpenAIFileAdapter(this.config)
  }

  createVectorStores(): VectorStoreAdapter {
    return new OpenAIVectorStoreAdapter(this.config)
  }
}
