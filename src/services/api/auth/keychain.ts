/**
 * macOS Keychain 认证 — 从 keychain 读取 API key
 *
 * 从 auth.ts 提取: getApiKeyFromConfigOrMacOSKeychain()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import { getAnthropicApiKeyWithSource } from '../../../utils/auth.js'

export class KeychainAuthProvider implements AuthProvider {
  readonly name = 'keychain'

  async getCredentials(): Promise<AuthCredentials> {
    const { key } = getAnthropicApiKeyWithSource()
    if (key) {
      return { apiKey: key }
    }
    return {}
  }

  async refresh(): Promise<void> {
    // Keychain 数据不需要刷新
  }

  isAuthenticated(): boolean {
    const { key, source } = getAnthropicApiKeyWithSource()
    return key !== null && source !== 'none'
  }

  invalidate(): void {
    // Keychain 由系统管理
  }
}
