/**
 * Command prefix extraction — 包内 stub 实现。
 *
 * 完整实现位于 src/utils/shell/prefix.ts，依赖 queryHaiku / analytics / memoizeWithLRU
 * 等重量级基础设施，不适合放在纯 packages/shell 中。
 *
 * 此 stub 提供相同的类型签名和工厂函数，但始终返回 null（与原实现
 * 在 NODE_ENV=test 时的行为一致）。
 *
 * 桥接层（src/ 侧）可在运行时注入真正的实现来覆盖。
 */

// ─── 类型 ──────────────────────────────────────────────────────────

export type CommandPrefixResult = {
  commandPrefix: string | null
}

export type CommandSubcommandPrefixResult = CommandPrefixResult & {
  subcommandPrefixes: Map<string, CommandPrefixResult>
}

export type PrefixExtractorConfig = {
  toolName: string
  policySpec: string
  eventName: string
  querySource: string
  preCheck?: (command: string) => CommandPrefixResult | null
}

// ─── 简易 LRU 缓存 ─────────────────────────────────────────────────

function createLRUCache<K, V>(maxSize: number) {
  const cache = new Map<K, V>()
  return {
    get(key: K): V | undefined {
      const val = cache.get(key)
      if (val !== undefined) {
        cache.delete(key)
        cache.set(key, val)
      }
      return val
    },
    set(key: K, value: V): void {
      cache.delete(key)
      cache.set(key, value)
      if (cache.size > maxSize) {
        const first = cache.keys().next().value
        if (first !== undefined) cache.delete(first)
      }
    },
    delete(key: K): boolean {
      return cache.delete(key)
    },
    has(key: K): boolean {
      return cache.has(key)
    },
    get size(): number {
      return cache.size
    },
  }
}

// ─── 工厂函数 ──────────────────────────────────────────────────────

/**
 * 创建命令前缀提取器（stub 版本）。
 * 完整实现通过桥接层在运行时注入。
 */
export function createCommandPrefixExtractor(
  _config: PrefixExtractorConfig,
): ((
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
) => Promise<CommandPrefixResult | null>) & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>()

  const fn = async (
    _command: string,
    _abortSignal?: AbortSignal,
    _isNonInteractiveSession?: boolean,
  ): Promise<CommandPrefixResult | null> => {
    // Stub: 始终返回 null，与原实现 NODE_ENV=test 行为一致
    return null
  }

  fn.cache = cache
  return fn
}

/**
 * 创建子命令前缀提取器（stub 版本）。
 */
export function createSubcommandPrefixExtractor(
  _getPrefix: (
    command: string,
    abortSignal: AbortSignal,
    isNonInteractiveSession: boolean,
  ) => Promise<CommandPrefixResult | null>,
  _splitCommand: (command: string) => string[] | Promise<string[]>,
): ((
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
) => Promise<CommandSubcommandPrefixResult | null>) & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>()

  const fn = async (
    _command: string,
    _abortSignal?: AbortSignal,
    _isNonInteractiveSession?: boolean,
  ): Promise<CommandSubcommandPrefixResult | null> => {
    // Stub: 始终返回 null
    return null
  }

  fn.cache = cache
  return fn
}
