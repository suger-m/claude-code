/**
 * API Key 认证 — Anthropic API Key / Auth Token / ApiKeyHelper
 *
 * 从 auth.ts 提取: getAnthropicApiKey(), getApiKeyFromApiKeyHelper()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import {
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getAnthropicApiKeyWithSource,
} from '../../../utils/auth.js'
import { getIsNonInteractiveSession } from '../../../bootstrap/state.js'
import { logForDebugging } from '../../../utils/debug.js'

export class ApiKeyAuthProvider implements AuthProvider {
  readonly name = 'apiKey'

  async getCredentials(): Promise<AuthCredentials> {
    const apiKey = getAnthropicApiKey()
    if (apiKey) {
      return { apiKey }
    }

    // 尝试从 apiKeyHelper 获取
    const helperKey = await getApiKeyFromApiKeyHelper(
      getIsNonInteractiveSession(),
    )
    if (helperKey) {
      return { apiKey: helperKey }
    }

    // 检查 ANTHROPIC_AUTH_TOKEN
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN
    if (authToken) {
      return { authToken }
    }

    return {}
  }

  async refresh(): Promise<void> {
    // API key 不需要刷新
    logForDebugging('[Auth:apiKey] No refresh needed for API key auth')
  }

  isAuthenticated(): boolean {
    const { key, source } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    return key !== null && source !== 'none'
  }

  invalidate(): void {
    // API key 没有缓存需要清除
  }
}
