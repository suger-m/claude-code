/**
 * FoundryAdapter — Azure Foundry provider adapter
 *
 * Foundry 使用 AnthropicFoundry SDK，事件格式与 1P 相同，
 * 区别在于认证 (Azure AD / Managed Identity) 和 resource URL。
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
 * Foundry provider 能力
 */
export const foundryCapabilities: ProviderCapabilities = {
	promptCaching: true,
	streaming: true,
	thinking: true,
	betasInExtraBody: false,
	toolSearch: true,
	clientRequestId: false,
}

/**
 * FoundryAdapter 实现
 *
 * 直接调用 claude.ts 内部的 queryModel()，
 * 绕过 queryModelWithStreaming 的 feature flag 分支，避免递归。
 */
export class FoundryAdapter implements ProviderAdapter {
	readonly name = 'foundry'
	readonly capabilities = foundryCapabilities

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
			process.env.ANTHROPIC_FOUNDRY_RESOURCE ||
			process.env.ANTHROPIC_FOUNDRY_BASE_URL ||
			process.env.ANTHROPIC_FOUNDRY_API_KEY
		)
	}
}
