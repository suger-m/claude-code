/**
 * AuthProvider 接口 — 统一 7 种认证方式的凭据获取
 *
 * 每个 AuthProvider 实现此接口，为 ProviderAdapter 提供认证凭据。
 */

import type { GoogleAuth } from 'google-auth-library'

/**
 * 认证凭据 — 涵盖所有 provider 的认证信息
 */
export interface AuthCredentials {
  /** Anthropic API Key (firstParty) */
  apiKey?: string
  /** OAuth access token (Claude AI subscriber) */
  authToken?: string
  /** Bearer token (AWS/Foundry) */
  accessToken?: string
  /** AWS IAM 凭据 (Bedrock) */
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
  /** GCP 认证 (Vertex) */
  googleAuth?: GoogleAuth
  /** Azure AD token provider (Foundry) */
  azureADTokenProvider?: (() => Promise<string>) | undefined
}

/**
 * AuthProvider 接口
 */
export interface AuthProvider {
  /** 认证方式名称 (如 'apiKey', 'oauth', 'awsIam', 'gcpAdc', 'azureManaged', 'keychain') */
  readonly name: string

  /**
   * 获取认证凭据
   * 内部处理 refresh 逻辑，调用方无需关心凭据是否过期
   */
  getCredentials(): Promise<AuthCredentials>

  /**
   * 强制刷新凭据 (如 OAuth token 续期、AWS STS 刷新)
   */
  refresh(): Promise<void>

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean

  /**
   * 清除缓存的凭据，强制下次 getCredentials() 重新获取
   */
  invalidate(): void
}
