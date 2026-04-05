/**
 * Provider 注册表 — 统一管理 ProviderAdapter 实例
 *
 * 替代 claude.ts 中的 if/else provider 分支:
 *   if (getAPIProvider() === 'openai') { ... }
 * 改为:
 *   getProvider().queryStreaming(params)
 */

import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type { ProviderAdapter, QueryParams } from './types.js'
import { getAPIProvider } from '../../../utils/model/providers.js'
import { AnthropicAdapter } from './anthropic.js'
import { OpenAIAdapter } from './openai.js'
import { BedrockAdapter } from './bedrock.js'
import { VertexAdapter } from './vertex.js'
import { FoundryAdapter } from './foundry.js'

/** 已注册的 adapter 实例 */
const adapters: Map<string, ProviderAdapter> = new Map()

/** 默认 adapter — 懒初始化 */
let defaultAdapter: ProviderAdapter | undefined

/**
 * 注册一个 provider adapter
 */
export function registerProvider(adapter: ProviderAdapter): void {
  adapters.set(adapter.name, adapter)
}

/**
 * 按 name 获取已注册的 adapter，或根据当前 getAPIProvider() 返回默认 adapter
 */
export function getProvider(name?: string): ProviderAdapter {
  if (name) {
    // 先查注册表
    const adapter = adapters.get(name)
    if (adapter) return adapter
    // 回退到按类型创建
    return createProviderForType(name)
  }

  // 懒初始化默认 adapter
  if (!defaultAdapter) {
    defaultAdapter = createProviderForType(getAPIProvider())
  }
  return defaultAdapter
}

/**
 * 根据 APIProvider 类型创建对应的 adapter
 */
function createProviderForType(type: string): ProviderAdapter {
  // 先查注册表（支持 adapter name 和 provider type 两种 key）
  const registered = adapters.get(type) ?? adapters.get(typeToAdapterName(type))
  if (registered) return registered

  // 按类型创建默认实例
  switch (type) {
    case 'firstParty':
    case 'anthropic':
      return new AnthropicAdapter()
    case 'openai':
      return new OpenAIAdapter()
    case 'bedrock':
      return new BedrockAdapter()
    case 'vertex':
      return new VertexAdapter()
    case 'foundry':
      return new FoundryAdapter()
    default:
      // 未知类型 fallback 到 Anthropic 1P
      return new AnthropicAdapter()
  }
}

/** 将 provider type 映射到 adapter name */
function typeToAdapterName(type: string): string {
  switch (type) {
    case 'firstParty':
      return 'anthropic'
    default:
      return type
  }
}

/**
 * 重置默认 adapter (用于测试或 provider 切换)
 */
export function resetDefaultProvider(): void {
  defaultAdapter = undefined
}

/**
 * 统一查询入口 — 替代 claude.ts 中的 provider if/else 分支
 */
export async function* queryWithProvider(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  const provider = getProvider()
  yield* provider.queryStreaming(params)
}
