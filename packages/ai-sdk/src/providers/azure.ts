import { defineOpenAiCompatible } from './openai-compatible.js'

export interface AzureOpenAIConfig {
  apiKey: string
  /** Azure endpoint, e.g. https://my-resource.openai.azure.com/openai/deployments/my-deployment */
  baseUrl: string
}

// No default base URL: the endpoint carries the resource and deployment names,
// so it can only come from the caller.
export class AzureOpenAIProvider extends defineOpenAiCompatible<AzureOpenAIConfig>({
  name: 'azure',
}) {}
