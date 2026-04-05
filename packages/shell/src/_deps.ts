/**
 * 平台和运行时依赖注入点。
 * 由 src/ 侧桥接层在启动时设置。
 * packages/shell 内部所有需要平台/运行时信息的模块都从这里导入。
 */

type Platform = 'macos' | 'linux' | 'windows'

// ─── 平台检测 ─────────────────────────────────────────────────────

let _getPlatformFn: () => Platform = () => {
  const p = process.platform
  if (p === 'darwin') return 'macos'
  if (p === 'linux') return 'linux'
  if (p === 'win32') return 'windows'
  return 'linux' // fallback
}

export function getPlatform(): Platform {
  return _getPlatformFn()
}

export function setGetPlatformFn(fn: () => Platform): void {
  _getPlatformFn = fn
}

// ─── Which 命令查找 ───────────────────────────────────────────────

let _whichFn: (command: string) => Promise<string | null> = async (
  command: string,
) => {
  try {
    const { which } = await import('../which.js')
    return which(command)
  } catch {
    // Fallback: use PATH lookup
    const { execFile } = await import('child_process')
    return new Promise(resolve => {
      execFile(
        process.platform === 'win32' ? 'where' : 'which',
        [command],
        (err, stdout) => {
          resolve(err ? null : stdout.trim().split('\n')[0]!)
        },
      )
    })
  }
}

export function which(command: string): Promise<string | null> {
  return _whichFn(command)
}

export function setWhichFn(fn: (command: string) => Promise<string | null>): void {
  _whichFn = fn
}

// ─── 环境变量工具 ─────────────────────────────────────────────────

export function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function isEnvDefinedFalsy(value: string | undefined): boolean {
  if (value === undefined) return false
  return ['0', 'false', 'no', 'off', ''].includes(value.toLowerCase())
}

// ─── 环境变量验证 ─────────────────────────────────────────────────

export function validateBoundedIntEnvVar(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
  upperLimit: number,
): { effective: number; source: 'default' | 'env' } {
  if (rawValue === undefined) {
    return { effective: defaultValue, source: 'default' }
  }
  const parsed = parseInt(rawValue, 10)
  if (isNaN(parsed) || parsed < 0) {
    return { effective: defaultValue, source: 'default' }
  }
  return {
    effective: Math.min(parsed, upperLimit),
    source: 'env',
  }
}

// ─── Windows 路径转换 ───────────────────────────────────────────────

let _windowsPathToPosixPathFn: ((path: string) => string) | undefined

/**
 * 设置 windowsPathToPosixPath 函数。由 src/ 桥接层在启动时调用。
 */
export function setWindowsPathToPosixPathFn(fn: (path: string) => string): void {
  _windowsPathToPosixPathFn = fn
}

/**
 * 将 Windows 路径转为 POSIX 路径。仅在 Windows 平台使用。
 * 如果未注入，使用内联 fallback。
 */
export function windowsPathToPosixPath(path: string): string {
  if (_windowsPathToPosixPathFn) return _windowsPathToPosixPathFn(path)
  // Inline fallback: UNC + drive letter + slash flip
  if (path.startsWith('\\\\')) return path.replace(/\\/g, '/')
  const match = path.match(/^([A-Za-z]):[/\\]/)
  if (match) return '/' + match[1]!.toLowerCase() + path.slice(2).replace(/\\/g, '/')
  return path.replace(/\\/g, '/')
}

// ─── 任务 ID 生成 ──────────────────────────────────────────────────

let _generateTaskIdFn: ((prefix: string) => string) | undefined

export function setGenerateTaskIdFn(fn: (prefix: string) => string): void {
  _generateTaskIdFn = fn
}

/**
 * 生成任务 ID。未注入时使用内联 fallback。
 */
export function generateTaskId(prefix: string): string {
  if (_generateTaskIdFn) return _generateTaskIdFn(prefix)
  // Inline fallback: prefix + random hex
  const hex = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${hex}`
}

// ─── 日志 ──────────────────────────────────────────────────────────

export function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message)
  }
}

export function logForDebugging(msg: string): void {
  // 默认 no-op，由桥接层覆盖
}

export function logEvent(
  _name: string,
  _data: Record<string, unknown>,
): void {
  // 默认 no-op，由桥接层覆盖
}

// ─── 错误工具 ──────────────────────────────────────────────────────

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isENOENT(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code: string }).code === 'ENOENT'
  }
  return false
}

// ─── Windows 路径转换 (posix → windows) ──────────────────────────────

let _posixPathToWindowsPathFn: ((path: string) => string) | undefined

export function setPosixPathToWindowsPathFn(fn: (path: string) => string): void {
  _posixPathToWindowsPathFn = fn
}

export function posixPathToWindowsPath(path: string): string {
  if (_posixPathToWindowsPathFn) return _posixPathToWindowsPathFn(path)
  // Inline fallback: convert /c/path to C:\path
  const match = path.match(/^\/([a-z])(\/.*)/)
  if (match) return match[1]!.toUpperCase() + ':' + match[2]!.replace(/\//g, '\\')
  return path.replace(/\//g, '\\')
}
