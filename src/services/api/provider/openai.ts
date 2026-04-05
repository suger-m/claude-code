/**
 * OpenAIAdapter — OpenAI 兼容 provider adapter
 *
 * 包装现有 src/services/api/openai/ 的 queryModelOpenAI()。
 * 已有的 882 行代码作为 adapter 的核心实现。
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
 * OpenAI provider 能力
 */
export const openaiCapabilities: ProviderCapabilities = {
  promptCaching: false,
  streaming: true,
  thinking: false,
  betasInExtraBody: false,
  toolSearch: false,
  clientRequestId: false,
}

/**
 * OpenAIAdapter 实现
 *
 * 包装现有 openai/index.ts 的 queryModelOpenAI()。
 * 消息预处理由 claude.ts 的共享逻辑完成（normalizeMessagesForAPI 等），
 * 此 adapter 仅负责 OpenAI 格式转换和流适配。
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai'
  readonly capabilities = openaiCapabilities

  async *queryStreaming(
    params: QueryParams,
  ): AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  > {
    const { normalizeMessagesForAPI } = await import(
      '../../../utils/messages.js'
    )
    const { toolToAPISchema } = await import('../../../utils/api.js')
    const { getEmptyToolPermissionContext } = await import('../../../Tool.js')

    // 共享消息预处理
    let messagesForAPI = normalizeMessagesForAPI(params.messages, params.tools)

    // Build tool schemas
    const toolSchemas = await Promise.all(
      params.tools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: params.options.getToolPermissionContext,
          tools: params.tools,
          agents: params.options.agents,
          allowedAgentTypes: params.options.allowedAgentTypes,
          model: params.options.model,
        }),
      ),
    )

    // 委托给现有 OpenAI 兼容层
    const { queryModelOpenAI } = await import('../openai/index.js')
    yield* queryModelOpenAI(
      messagesForAPI,
      params.systemPrompt,
      params.tools,
      params.signal,
      params.options,
    )
  }

  async query(_params: QueryParams): Promise<BetaMessage> {
    // OpenAI 兼容层当前不提供非流式查询
    throw new Error('OpenAIAdapter does not support non-streaming query')
  }

  isAvailable(): boolean {
    // 检查是否配置了 OpenAI 相关环境变量
    return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL)
  }
}
