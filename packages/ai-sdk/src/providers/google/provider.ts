import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  ImageGenerationAdapter,
  FileAdapter,
  VectorStoreAdapter,
} from '../../types.js'
import type { GoogleCacheRegistry } from '../google-cache-registry.js'
import type { GoogleConfig } from './config.js'
import { GoogleAdapter } from './chat.js'
import { GoogleEmbeddingAdapter } from './embeddings.js'
import { GoogleImageAdapter } from './images.js'
import { GoogleFileAdapter } from './files.js'
import { GoogleVectorStoreAdapter } from './vector-store.js'

export class GoogleProvider implements ProviderFactory {
  readonly name = 'google'
  private readonly config: GoogleConfig
  private readonly cacheRegistry?: GoogleCacheRegistry

  constructor(config: GoogleConfig, cacheRegistry?: GoogleCacheRegistry) {
    this.config = config
    if (cacheRegistry) this.cacheRegistry = cacheRegistry
  }

  create(model: string): ProviderAdapter {
    return new GoogleAdapter(this.config, model, this.cacheRegistry)
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new GoogleEmbeddingAdapter(this.config, model)
  }

  createImage(model: string): ImageGenerationAdapter {
    return new GoogleImageAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new GoogleFileAdapter(this.config)
  }

  createVectorStores(): VectorStoreAdapter {
    return new GoogleVectorStoreAdapter(this.config)
  }
}
