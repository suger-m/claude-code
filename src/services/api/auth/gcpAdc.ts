/**
 * GCP ADC 认证 — Vertex AI provider
 *
 * 从 auth.ts 提取: refreshGcpAuth(), refreshGcpCredentialsIfNeeded()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import type { GoogleAuth } from 'google-auth-library'
import {
  refreshGcpCredentialsIfNeeded,
  clearGcpCredentialsCache,
} from '../../../utils/auth.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { logForDebugging } from '../../../utils/debug.js'

export class GcpAdcAuthProvider implements AuthProvider {
  readonly name = 'gcpAdc'

  async getCredentials(): Promise<AuthCredentials> {
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
      // Mock GoogleAuth for testing/proxy scenarios
      return {
        googleAuth: {
          getClient: () => ({
            getRequestHeaders: () => ({}),
          }),
        } as unknown as GoogleAuth,
      }
    }

    // 刷新凭据（如果需要）
    await refreshGcpCredentialsIfNeeded()

    // GoogleAuth 实例由 client.ts 创建 — 这里仅标记认证状态
    return {}
  }

  async refresh(): Promise<void> {
    logForDebugging('[Auth:gcpAdc] Refreshing GCP credentials')
    clearGcpCredentialsCache()
    await refreshGcpCredentialsIfNeeded()
  }

  isAuthenticated(): boolean {
    return !!(
      process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.CLOUD_ML_REGION
    )
  }

  invalidate(): void {
    clearGcpCredentialsCache()
  }
}
