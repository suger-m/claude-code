/**
 * AWS IAM/STS 认证 — Bedrock provider
 *
 * 从 auth.ts 提取: refreshAwsAuth(), refreshAndGetAwsCredentials()
 */

import type { AuthProvider, AuthCredentials } from './types.js'
import {
  refreshAndGetAwsCredentials,
  clearAwsCredentialsCache,
} from '../../../utils/auth.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { logForDebugging } from '../../../utils/debug.js'

export class AwsIamAuthProvider implements AuthProvider {
  readonly name = 'awsIam'

  async getCredentials(): Promise<AuthCredentials> {
    // Bearer token 方式
    if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
      return { accessToken: process.env.AWS_BEARER_TOKEN_BEDROCK }
    }

    // 跳过认证模式
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
      return {}
    }

    // IAM/STS 凭据
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      return {
        awsAccessKey: cachedCredentials.accessKeyId,
        awsSecretKey: cachedCredentials.secretAccessKey,
        awsSessionToken: cachedCredentials.sessionToken,
      }
    }

    return {}
  }

  async refresh(): Promise<void> {
    logForDebugging('[Auth:awsIam] Refreshing AWS credentials')
    clearAwsCredentialsCache()
    // refreshAndGetAwsCredentials 内部会处理刷新逻辑
  }

  isAuthenticated(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_BEARER_TOKEN_BEDROCK
    )
  }

  invalidate(): void {
    clearAwsCredentialsCache()
  }
}
