/**
 * Azure Managed Identity 认证 — Foundry provider
 *
 * 从 client.ts 提取: DefaultAzureCredential + getBearerTokenProvider()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { logForDebugging } from '../../../utils/debug.js'

export class AzureManagedAuthProvider implements AuthProvider {
  readonly name = 'azureManaged'

  async getCredentials(): Promise<AuthCredentials> {
    // 如果有 API Key，优先使用
    if (process.env.ANTHROPIC_FOUNDRY_API_KEY) {
      return { apiKey: process.env.ANTHROPIC_FOUNDRY_API_KEY }
    }

    // 跳过认证模式
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)) {
      return {
        azureADTokenProvider: () => Promise.resolve(''),
      }
    }

    // Azure AD 认证
    try {
      const {
        DefaultAzureCredential: AzureCredential,
        getBearerTokenProvider,
      } = await import('@azure/identity')
      const azureADTokenProvider = getBearerTokenProvider(
        new AzureCredential(),
        'https://cognitiveservices.azure.com/.default',
      )
      return { azureADTokenProvider }
    } catch (error) {
      logForDebugging(
        `[Auth:azureManaged] Failed to get Azure AD token: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' },
      )
      return {}
    }
  }

  async refresh(): Promise<void> {
    // Azure AD token 由 SDK 自动刷新
    logForDebugging('[Auth:azureManaged] Token refresh handled by Azure SDK')
  }

  isAuthenticated(): boolean {
    return !!(
      process.env.ANTHROPIC_FOUNDRY_API_KEY ||
      process.env.ANTHROPIC_FOUNDRY_RESOURCE ||
      process.env.ANTHROPIC_FOUNDRY_BASE_URL
    )
  }

  invalidate(): void {
    // Azure SDK 管理凭据缓存
  }
}
