import { describe, test, expect, mock } from 'bun:test'

// 在测试前设置必要的环境变量，避免 auth.ts 中无 key 报错
process.env.ANTHROPIC_API_KEY = 'test-api-key-for-provider-test'

describe('Auth Providers', () => {
  describe('ApiKeyAuthProvider', () => {
    test('has correct name', async () => {
      const { ApiKeyAuthProvider } = await import('../apiKey.js')
      const provider = new ApiKeyAuthProvider()
      expect(provider.name).toBe('apiKey')
    })

    test('refresh does not throw', async () => {
      const { ApiKeyAuthProvider } = await import('../apiKey.js')
      const provider = new ApiKeyAuthProvider()
      await expect(provider.refresh()).resolves.toBeUndefined()
    })

    test('invalidate does not throw', async () => {
      const { ApiKeyAuthProvider } = await import('../apiKey.js')
      const provider = new ApiKeyAuthProvider()
      expect(() => provider.invalidate()).not.toThrow()
    })
  })

  describe('OAuthAuthProvider', () => {
    test('has correct name', async () => {
      const { OAuthAuthProvider } = await import('../oauth.js')
      const provider = new OAuthAuthProvider()
      expect(provider.name).toBe('oauth')
    })

    test('invalidate does not throw', async () => {
      const { OAuthAuthProvider } = await import('../oauth.js')
      const provider = new OAuthAuthProvider()
      expect(() => provider.invalidate()).not.toThrow()
    })
  })

  describe('AwsIamAuthProvider', () => {
    test('has correct name', async () => {
      const { AwsIamAuthProvider } = await import('../awsIam.js')
      const provider = new AwsIamAuthProvider()
      expect(provider.name).toBe('awsIam')
    })

    test('getCredentials returns empty without AWS env', async () => {
      const { AwsIamAuthProvider } = await import('../awsIam.js')
      const provider = new AwsIamAuthProvider()
      const creds = await provider.getCredentials()
      expect(creds).toBeDefined()
    })
  })

  describe('GcpAdcAuthProvider', () => {
    test('has correct name', async () => {
      const { GcpAdcAuthProvider } = await import('../gcpAdc.js')
      const provider = new GcpAdcAuthProvider()
      expect(provider.name).toBe('gcpAdc')
    })

    test('isAuthenticated returns boolean', async () => {
      const { GcpAdcAuthProvider } = await import('../gcpAdc.js')
      const provider = new GcpAdcAuthProvider()
      expect(typeof provider.isAuthenticated()).toBe('boolean')
    })
  })

  describe('AzureManagedAuthProvider', () => {
    test('has correct name', async () => {
      const { AzureManagedAuthProvider } = await import('../azureManaged.js')
      const provider = new AzureManagedAuthProvider()
      expect(provider.name).toBe('azureManaged')
    })

    test('getCredentials with FOUNDRY_API_KEY returns apiKey', async () => {
      const { AzureManagedAuthProvider } = await import('../azureManaged.js')
      const original = process.env.ANTHROPIC_FOUNDRY_API_KEY
      process.env.ANTHROPIC_FOUNDRY_API_KEY = 'test-key'
      try {
        const provider = new AzureManagedAuthProvider()
        const creds = await provider.getCredentials()
        expect(creds.apiKey).toBe('test-key')
      } finally {
        if (original) {
          process.env.ANTHROPIC_FOUNDRY_API_KEY = original
        } else {
          delete process.env.ANTHROPIC_FOUNDRY_API_KEY
        }
      }
    })
  })

  describe('KeychainAuthProvider', () => {
    test('has correct name', async () => {
      const { KeychainAuthProvider } = await import('../keychain.js')
      const provider = new KeychainAuthProvider()
      expect(provider.name).toBe('keychain')
    })

    test('getCredentials returns object', async () => {
      const { KeychainAuthProvider } = await import('../keychain.js')
      const provider = new KeychainAuthProvider()
      const creds = await provider.getCredentials()
      expect(creds).toBeDefined()
      expect(typeof creds).toBe('object')
    })
  })
})
