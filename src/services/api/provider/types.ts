/**
 * ProviderAdapter 接口 — 统一 5 种 LLM provider 的查询入口
 *
 * 所有 provider (Anthropic/OpenAI/Bedrock/Vertex/Foundry) 实现此接口，
 * 通过 registry 注册后供 claude.ts 主路径调用。
 */

import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type { AbortSignal } from 'node:async_apis'
import type {
  Message,
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type {
  Tools,
  ToolPermissionContext,
  QueryChainTracking,
} from '../../../Tool.js'
import type { AgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from '../../../types/ids.js'
import type { EffortValue } from '../../../utils/effort.js'
import type { QuerySource } from '../../../constants/querySource.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import type { Notification } from '../../../context/notifications.js'
import type { BetaJSONOutputFormat } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  BetaToolChoiceTool,
  BetaToolChoiceAuto,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * 查询参数 — 对应 claude.ts 的 Options + 消息/系统提示/工具
 */
export interface QueryParams {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: QueryOptions
}

/**
 * 与 claude.ts 的 Options 类型对齐，逐步收敛为 provider 无关的参数
 */
export interface QueryOptions {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: Notification) => void
  taskBudget?: { total: number; remaining?: number }
}

/**
 * Provider 能力声明 — 用于替代散落的 getAPIProvider() === 'xxx' 检查
 */
export interface ProviderCapabilities {
  /** 是否支持 prompt caching */
  promptCaching: boolean
  /** 是否支持 streaming */
  streaming: boolean
  /** 是否支持 thinking/extended thinking */
  thinking: boolean
  /** beta header 放在 extraBody 而非 betas 数组 */
  betasInExtraBody: boolean
  /** 是否支持 tool search beta */
  toolSearch: boolean
  /** 是否需要 client request ID 注入 */
  clientRequestId: boolean
}

/**
 * ProviderAdapter 接口
 *
 * 每个 LLM provider 实现此接口，提供统一的查询入口。
 */
export interface ProviderAdapter {
  /** provider 名称 (如 'anthropic', 'openai', 'bedrock', 'vertex', 'foundry') */
  readonly name: string

  /** provider 能力声明 */
  readonly capabilities: ProviderCapabilities

  /**
   * 流式查询 (主路径)
   *
   * 返回归一化事件流，与 claude.ts 的 queryModel() yield 格式一致:
   * StreamEvent | AssistantMessage | SystemAPIErrorMessage
   */
  queryStreaming(
    params: QueryParams,
  ): AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  >

  /**
   * 非流式查询 (sideQuery 等使用)
   */
  query(params: QueryParams): Promise<BetaMessage>

  /**
   * 可用性检查 — 验证凭据/配置是否就绪
   */
  isAvailable(): boolean
}
