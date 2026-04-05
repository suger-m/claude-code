/**
 * AnthropicAdapter — Anthropic 1P (first party) provider adapter
 *
 * Wrapper 模式: 直接调用 claude.ts 的内部 queryModel()（不含 feature flag），
 * 避免经过 queryModelWithStreaming 导致无限递归。
 */

import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  Message,
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type {
  ProviderAdapter,
  ProviderCapabilities,
  QueryParams,
} from './types.js'

/**
 * Anthropic 1P provider 能力
 */
export const anthropicCapabilities: ProviderCapabilities = {
  promptCaching: true,
  streaming: true,
  thinking: true,
  betasInExtraBody: false,
  toolSearch: true,
  clientRequestId: true,
}

/**
 * AnthropicAdapter 实现
 *
 * 直接调用 claude.ts 内部的 queryModel()（已 export），
 * 绕过 queryModelWithStreaming 的 feature flag 分支，避免递归。
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic'
  readonly capabilities = anthropicCapabilities

  async *queryStreaming(
    params: QueryParams,
  ): AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  > {
    // 直接调用内部 queryModel — 它不含 feature flag 分支，不会递归
    const { queryModel } = await import('../claude.js')
    yield* queryModel(
      params.messages,
      params.systemPrompt,
      params.thinkingConfig,
      params.tools,
      params.signal,
      params.options,
    )
  }

  async query(params: QueryParams): Promise<BetaMessage> {
    const { queryModel } = await import('../claude.js')
    let assistantMessage: AssistantMessage | undefined
    for await (const msg of queryModel(
      params.messages,
      params.systemPrompt,
      params.thinkingConfig,
      params.tools,
      params.signal,
      params.options,
    )) {
      if (msg.type === 'assistant') {
        assistantMessage = msg as AssistantMessage
      }
    }
    if (!assistantMessage) {
      throw new Error('No assistant message found')
    }
    return assistantMessage as unknown as BetaMessage
  }

  isAvailable(): boolean {
    return true
  }
}
