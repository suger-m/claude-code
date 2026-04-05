/**
 * packages/shell 对外部运行时环境的依赖接口。
 * 由 src/ 侧适配器实现，传入 packages/shell 的函数中。
 * 所有对 src/ 模块的耦合都通过此接口解耦。
 */

export interface ShellExecContext {
  // ─── CWD 管理 ───────────────────────────────────────────────────
  getCwd(): string
  setCwd(path: string): void
  getOriginalCwd(): string

  // ─── 会话 ──────────────────────────────────────────────────────
  getSessionId(): string

  // ─── 日志 ──────────────────────────────────────────────────────
  logEvent(name: string, data: Record<string, unknown>): void
  logForDebugging(msg: string): void

  // ─── 会话环境 ──────────────────────────────────────────────────
  getSessionEnvVars(): Iterable<[string, string]>
  getSessionEnvironmentScript(): Promise<string>

  // ─── 沙盒 ─────────────────────────────────────────────────────
  wrapWithSandbox?(
    cmd: string,
    shell: string,
    tmpDir: string | undefined,
    signal: AbortSignal,
  ): Promise<string>
  cleanupAfterSandbox?(): void

  // ─── CWD 变更回调 ─────────────────────────────────────────────
  onCwdChanged?(oldCwd: string, newCwd: string): Promise<void>

  // ─── Tmux 隔离 ────────────────────────────────────────────────
  getTmuxEnv?(command: string): Promise<string | null>
  ensureTmuxSocket?(): Promise<void>
  hasTmuxToolBeenUsed?(): boolean

  // ─── 上游代理 ─────────────────────────────────────────────────
  registerUpstreamProxyEnvFn?(fn: () => Record<string, string>): void
  getUpstreamProxyEnv?(): Record<string, string>

  // ─── 平台工具 ─────────────────────────────────────────────────
  getPlatform(): 'macos' | 'linux' | 'windows'
  which(command: string): Promise<string | null>

  // ─── 会话环境缓存失效 ──────────────────────────────────────────
  invalidateSessionEnvCache?(): void

  // ─── 任务输出 ─────────────────────────────────────────────────
  getTaskOutputDir(): string
  generateTaskId(prefix: string): string
  getMaxTaskOutputBytes(): number

  // ─── 沙盒临时目录名 ──────────────────────────────────────────────
  getSandboxTmpDirName?(): string
}

/**
 * Shell 环境快照创建所需的依赖接口。
 * 由 src/ 侧适配器实现，传入 createAndSaveSnapshot()。
 */
export interface SnapshotContext {
  // ─── 日志 ──────────────────────────────────────────────────────
  logEvent(name: string, data: Record<string, unknown>): void
  logForDebugging(msg: string): void
  logError(error: unknown): void

  // ─── 平台 ─────────────────────────────────────────────────────
  getPlatform(): 'macos' | 'linux' | 'windows'

  // ─── CWD ──────────────────────────────────────────────────────
  getCwd(): string

  // ─── 配置目录 ─────────────────────────────────────────────────
  getClaudeConfigHomeDir(): string

  // ─── 文件系统 ─────────────────────────────────────────────────
  pathExists(path: string): Promise<boolean>
  getFs(): {
    unlink(path: string): Promise<void>
    readdir(path: string): Promise<string[]>
  }

  // ─── 清理注册 ─────────────────────────────────────────────────
  registerCleanup(fn: () => Promise<void>): void

  // ─── 嵌入式搜索工具 ──────────────────────────────────────────
  hasEmbeddedSearchTools(): boolean
  embeddedSearchToolsBinaryPath(): string

  // ─── Ripgrep ─────────────────────────────────────────────────
  ripgrepCommand(): {
    rgPath: string
    rgArgs: string[]
    argv0?: string
  }

  // ─── 子进程环境变量 ──────────────────────────────────────────
  subprocessEnv(): Record<string, string | undefined>
}
