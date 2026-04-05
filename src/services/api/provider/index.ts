/**
 * Provider 适配器层入口
 *
 * 统一导出 ProviderAdapter 接口、注册表、和所有 adapter 实现。
 */

export type {
  ProviderAdapter,
  ProviderCapabilities,
  QueryParams,
  QueryOptions,
} from './types.js'
export {
  getProvider,
  registerProvider,
  queryWithProvider,
  resetDefaultProvider,
} from './registry.js'
export { AnthropicAdapter, anthropicCapabilities } from './anthropic.js'
export { OpenAIAdapter, openaiCapabilities } from './openai.js'
export { BedrockAdapter, bedrockCapabilities } from './bedrock.js'
export { VertexAdapter, vertexCapabilities } from './vertex.js'
export { FoundryAdapter, foundryCapabilities } from './foundry.js'
