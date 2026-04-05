/**
 * VertexAdapter — GCP Vertex AI provider adapter
 *
 * Vertex 使用 AnthropicVertex SDK，事件格式与 1P 相同，
 * 区别在于认证 (GCP ADC) 和区域逻辑。
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
 * Vertex provider 能力
 */
export const vertexCapabilities: ProviderCapabilities = {
	promptCaching: true,
	streaming: true,
	thinking: true,
	betasInExtraBody: false,
	toolSearch: true,
	clientRequestId: false,
}

/**
 * VertexAdapter 实现
 *
 * 直接调用 claude.ts 内部的 queryModel()，
 * 绕过 queryModelWithStreaming 的 feature flag 分支，避免递归。
 */
export class VertexAdapter implements ProviderAdapter {
	readonly name = 'vertex'
	readonly capabilities = vertexCapabilities

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
			process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
			process.env.GOOGLE_APPLICATION_CREDENTIALS ||
			process.env.CLOUD_ML_REGION
		)
	}
}
