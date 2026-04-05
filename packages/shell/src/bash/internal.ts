/**
 * 内部兼容层 — 替代 bash 模块对 src/ 的外部依赖。
 * 仅提供 bash 解析/引用/命令分析所需的最小功能。
 */

// ─── 日志 ──────────────────────────────────────────────────────────

/** 替代 src/utils/log.js 的 logError */
export function _logError(error: unknown): void {
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  } else {
    console.error(String(error))
  }
}

/** 替代 src/utils/debug.js 的 logForDebugging */
export function _logForDebugging(_msg: string): void {
  // shell 包内不输出 debug 日志
  // 实际日志由 ShellExecContext.logForDebugging 处理
}

/** 替代 src/services/analytics/index.js 的 logEvent */
export function _logEvent(
  _name: string,
  _data: Record<string, unknown>,
): void {
  // shell 包内不发 analytics 事件
  // 实际日志由 ShellExecContext.logEvent 处理
}

// ─── 工具函数 ──────────────────────────────────────────────────────

/**
 * 替代 src/utils/slowOperations.js 的 jsonStringify
 * 仅用于 shell-quote 的 fallback quote 路径
 */
export function _jsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 简单 LRU 缓存，替代 src/utils/memoize.js 的 memoizeWithLRU
 */
export function _memoizeWithLRU<T extends (...args: any[]) => any>(
  fn: T,
  keyFn: (...args: Parameters<T>) => string,
  maxSize: number,
): T & { cache: Map<string, ReturnType<T>> } {
  const cache = new Map<string, ReturnType<T>>()
  const wrapped = ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn(...args)
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const result = fn(...args)
    cache.set(key, result)
    if (cache.size > maxSize) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }
    return result
  }) as T & { cache: Map<string, ReturnType<T>> }
  wrapped.cache = cache
  return wrapped
}
