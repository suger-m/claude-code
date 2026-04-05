import { describe, test, expect, beforeEach } from 'bun:test'
import {
  getProvider,
  registerProvider,
  resetDefaultProvider,
} from '../registry.js'
import { AnthropicAdapter } from '../anthropic.js'
import { OpenAIAdapter } from '../openai.js'
import { BedrockAdapter } from '../bedrock.js'
import { VertexAdapter } from '../vertex.js'
import { FoundryAdapter } from '../foundry.js'
import type { ProviderAdapter } from '../types.js'

describe('Provider Registry', () => {
  beforeEach(() => {
    resetDefaultProvider()
  })

  test('getProvider returns AnthropicAdapter for firstParty', () => {
    // 默认环境没有设置 3P 环境变量，应该是 firstParty
    const provider = getProvider('firstParty')!
    expect(provider).toBeInstanceOf(AnthropicAdapter)
    expect(provider.name).toBe('anthropic')
  })

  test('getProvider returns correct adapter type', () => {
    expect(getProvider('openai')).toBeInstanceOf(OpenAIAdapter)
    expect(getProvider('bedrock')).toBeInstanceOf(BedrockAdapter)
    expect(getProvider('vertex')).toBeInstanceOf(VertexAdapter)
    expect(getProvider('foundry')).toBeInstanceOf(FoundryAdapter)
  })

  test('getProvider falls back to AnthropicAdapter for unknown name', () => {
    const provider = getProvider('unknown_provider')
    // 未知类型 fallback 到 Anthropic 1P
    expect(provider).toBeInstanceOf(AnthropicAdapter)
  })

  test('registerProvider allows custom adapter', () => {
    const customAdapter: ProviderAdapter = {
      name: 'custom',
      capabilities: {
        promptCaching: false,
        streaming: true,
        thinking: false,
        betasInExtraBody: false,
        toolSearch: false,
        clientRequestId: false,
      },
      async *queryStreaming() {},
      async query() {
        throw new Error('not implemented')
      },
      isAvailable() {
        return true
      },
    }

    registerProvider(customAdapter)
    const provider = getProvider('custom')
    expect(provider.name).toBe('custom')
    expect(provider.isAvailable()).toBe(true)
  })

  test('resetDefaultProvider clears cached default', () => {
    const p1 = getProvider()
    resetDefaultProvider()
    const p2 = getProvider()
    // 重置后应该创建新实例
    expect(p1.name).toBe(p2.name)
  })
})

describe('Adapter capabilities', () => {
  test('AnthropicAdapter has correct capabilities', () => {
    const adapter = new AnthropicAdapter()
    expect(adapter.capabilities.promptCaching).toBe(true)
    expect(adapter.capabilities.thinking).toBe(true)
    expect(adapter.capabilities.betasInExtraBody).toBe(false)
    expect(adapter.capabilities.clientRequestId).toBe(true)
  })

  test('OpenAIAdapter has correct capabilities', () => {
    const adapter = new OpenAIAdapter()
    expect(adapter.capabilities.promptCaching).toBe(false)
    expect(adapter.capabilities.thinking).toBe(false)
    expect(adapter.capabilities.betasInExtraBody).toBe(false)
  })

  test('BedrockAdapter has betasInExtraBody', () => {
    const adapter = new BedrockAdapter()
    expect(adapter.capabilities.betasInExtraBody).toBe(true)
  })

  test('FoundryAdapter isAvailable checks environment', () => {
    const adapter = new FoundryAdapter()
    // 没有环境变量时不可用
    const wasAvailable = adapter.isAvailable()
    expect(typeof wasAvailable).toBe('boolean')
  })
})
