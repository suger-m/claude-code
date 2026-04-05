/**
 * BedrockAdapter — AWS Bedrock provider adapter
 *
 * Bedrock 使用 AnthropicBedrock SDK，事件格式与 1P 相同，
 * 区别在于认证 (AWS IAM/STS) 和区域逻辑。
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
 * Bedrock provider 能力
 */
export const bedrockCapabilities: ProviderCapabilities = {
	promptCaching: true,
	streaming: true,
	thinking: true,
	betasInExtraBody: true,
	toolSearch: true,
	clientRequestId: false,
}

/**
 * BedrockAdapter 实现
 *
 * 直接调用 claude.ts 内部的 queryModel()，
 * 绕过 queryModelWithStreaming 的 feature flag 分支，避免递归。
 */
export class BedrockAdapter implements ProviderAdapter {
	readonly name = 'bedrock'
	readonly capabilities = bedrockCapabilities

	async *queryStreaming(
		params: QueryParams,
	): AsyncGenerator<
		StreamEvent | AssistantMessage | SystemAPIErrorMessage,
		void
	> {
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
		return !!(
			process.env.AWS_ACCESS_KEY_ID ||
			process.env.AWS_PROFILE ||
			process.env.AWS_BEARER_TOKEN_BEDROCK
		)
	}
}
