/**
 * OAuth PKCE 认证 — Claude AI subscriber
 *
 * 从 auth.ts 提取: getClaudeAIOAuthTokens(), checkAndRefreshOAuthTokenIfNeeded()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import {
  getClaudeAIOAuthTokens,
  checkAndRefreshOAuthTokenIfNeeded,
  isClaudeAISubscriber,
  clearOAuthTokenCache,
} from '../../../utils/auth.js'
import { logForDebugging } from '../../../utils/debug.js'

export class OAuthAuthProvider implements AuthProvider {
  readonly name = 'oauth'

  async getCredentials(): Promise<AuthCredentials> {
    await checkAndRefreshOAuthTokenIfNeeded()

    if (!isClaudeAISubscriber()) {
      return {}
    }

    const tokens = getClaudeAIOAuthTokens()
    if (!tokens) {
      return {}
    }

    return {
      authToken: tokens.accessToken,
    }
  }

  async refresh(): Promise<void> {
    logForDebugging('[Auth:oauth] Refreshing OAuth tokens')
    clearOAuthTokenCache()
    await checkAndRefreshOAuthTokenIfNeeded()
  }

  isAuthenticated(): boolean {
    return isClaudeAISubscriber()
  }

  invalidate(): void {
    clearOAuthTokenCache()
  }
}
