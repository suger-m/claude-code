/**
 * packages/shell 导入验证测试
 *
 * 验证包的公共 API 可以通过 @anthropic/shell 正确导入，
 * 确保模块迁移后消费者不会因缺失导出而中断。
 */
import { describe, expect, test } from 'bun:test'

// ─── 从包入口导入 ──────────────────────────────────────────────────
import {
  // bash 解析层
  quote,
  tryParseShellCommand,
  tryQuoteShellArgs,
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  quoteShellCommand,
  shouldAddStdinRedirect,
  hasStdinRedirect,
  rearrangePipeCommand,
  formatShellPrefixCommand,

  // bash AST / 解析器
  parseCommand,
  ensureInitialized,
  extractCommandArguments,
  parseCommandRaw,
  PARSE_ABORTED,

  // bash 命令分析
  splitCommand_DEPRECATED,
  splitCommandWithOperators,
  filterControlOperators,
  isHelpCommand,
  isUnsafeCompoundCommand_DEPRECATED,
  extractOutputRedirections,
  clearCommandPrefixCaches,

  // bash 前缀提取 (prefix.ts — 静态，无 LLM)
  getCommandPrefixStatic,
  getCompoundCommandPrefixesStatic,

  // bash heredoc
  extractHeredocs,
  restoreHeredocs,
  containsHeredoc,

  // bash spec 注册表
  getCommandSpec,
  loadFigSpec,

  // bash tree-sitter 分析
  analyzeCommand,
  extractQuoteContext,
  extractCompoundStructure,
  extractDangerousPatterns,
  hasActualOperatorNodes,

  // 类型 (值导出)
  SHELL_TYPES,
  DEFAULT_HOOK_SHELL,
  getMaxOutputLength,
  resolveDefaultShell,
  isPowerShellToolEnabled,
  SHELL_TOOL_NAMES,
  GIT_READ_ONLY_COMMANDS,
  validateFlags,
  FLAG_PATTERN,
  buildPrefix,
  DEPTH_RULES,

  // 依赖注入设置
  setGetPlatformFn,
  setWhichFn,
  setWindowsPathToPosixPathFn,

  // Phase 2: Provider 实现
  createBashShellProvider,
  createPowerShellProvider,
  buildPowerShellArgs,

  // Phase 2: Shell 快照
  createAndSaveSnapshot,
  createRipgrepShellIntegration,
  createFindGrepShellIntegration,

  // Phase 3: 子进程环境
  subprocessEnv,
  registerUpstreamProxyEnvFn,

  // Phase 3: ShellCommand
  wrapSpawn,
  createAbortedCommand,
  createFailedCommand,

  // Phase 3: Shell 发现
  findSuitableShell,
  createProviderResolver,
  createShellConfigFactory,
  createPsProviderFactory,

  // Phase 3: exec 核心
  exec,
  setCwd,
  setCreateTaskOutputFn,
  setGetSandboxTmpDirNameFn,
} from '../index.js'

// ─── 类型导入验证（仅编译期） ──────────────────────────────────────
import type {
  ShellType,
  ShellProvider,
  ShellConfig,
  ExecOptions,
  ExecResult,
  ShellCommand,
  ShellExecContext,
  SnapshotContext,
  CommandSpec,
  Argument,
  Option,
  ParseEntry,
  ShellParseResult,
  ShellQuoteResult,
  PowerShellEdition,
  FlagArgType,
  ExternalCommandConfig,
} from '../index.js'

describe('@anthropic/shell import verification', () => {
  // ─── bash 解析层 ───────────────────────────────────────────────────

  test('shellQuote: quote and parse functions exist', () => {
    expect(typeof quote).toBe('function')
    expect(typeof tryParseShellCommand).toBe('function')
    expect(typeof tryQuoteShellArgs).toBe('function')
    expect(typeof hasMalformedTokens).toBe('function')
    expect(typeof hasShellQuoteSingleQuoteBug).toBe('function')
  })

  test('shellQuoting: quoteShellCommand works', () => {
    expect(typeof quoteShellCommand).toBe('function')
    expect(typeof shouldAddStdinRedirect).toBe('function')
    expect(typeof hasStdinRedirect).toBe('function')
  })

  test('bashPipeCommand: rearrangePipeCommand exists', () => {
    expect(typeof rearrangePipeCommand).toBe('function')
  })

  test('shellPrefix: formatShellPrefixCommand exists', () => {
    expect(typeof formatShellPrefixCommand).toBe('function')
  })

  // ─── bash AST / 解析器 ─────────────────────────────────────────────

  test('parser: parseCommand and ensureInitialized exist', () => {
    expect(typeof parseCommand).toBe('function')
    expect(typeof ensureInitialized).toBe('function')
    expect(typeof extractCommandArguments).toBe('function')
    expect(typeof parseCommandRaw).toBe('function')
    expect(typeof PARSE_ABORTED).toBe('symbol')
  })

  // ─── bash 命令分析 ─────────────────────────────────────────────────

  test('commands: splitCommand_DEPRECATED and helpers exist', () => {
    expect(typeof splitCommand_DEPRECATED).toBe('function')
    expect(typeof splitCommandWithOperators).toBe('function')
    expect(typeof filterControlOperators).toBe('function')
    expect(typeof isHelpCommand).toBe('function')
    expect(typeof isUnsafeCompoundCommand_DEPRECATED).toBe('function')
    expect(typeof extractOutputRedirections).toBe('function')
    expect(typeof clearCommandPrefixCaches).toBe('function')
  })

  // ─── bash 前缀提取 ─────────────────────────────────────────────────

  test('prefix: getCommandPrefixStatic and getCompoundCommandPrefixesStatic exist', () => {
    expect(typeof getCommandPrefixStatic).toBe('function')
    expect(typeof getCompoundCommandPrefixesStatic).toBe('function')
  })

  // ─── bash heredoc ──────────────────────────────────────────────────

  test('heredoc: extractHeredocs and helpers exist', () => {
    expect(typeof extractHeredocs).toBe('function')
    expect(typeof restoreHeredocs).toBe('function')
    expect(typeof containsHeredoc).toBe('function')
  })

  // ─── bash spec 注册表 ─────────────────────────────────────────────

  test('registry: getCommandSpec and loadFigSpec exist', () => {
    expect(typeof getCommandSpec).toBe('function')
    expect(typeof loadFigSpec).toBe('function')
  })

  // ─── bash tree-sitter 分析 ─────────────────────────────────────────

  test('treeSitterAnalysis: analyzeCommand and helpers exist', () => {
    expect(typeof analyzeCommand).toBe('function')
    expect(typeof extractQuoteContext).toBe('function')
    expect(typeof extractCompoundStructure).toBe('function')
    expect(typeof extractDangerousPatterns).toBe('function')
    expect(typeof hasActualOperatorNodes).toBe('function')
  })

  // ─── 常量导出 ──────────────────────────────────────────────────────

  test('types: SHELL_TYPES and DEFAULT_HOOK_SHELL exported', () => {
    expect(SHELL_TYPES).toContain('bash')
    expect(SHELL_TYPES).toContain('powershell')
    expect(DEFAULT_HOOK_SHELL).toBe('bash')
  })

  test('outputLimits: getMaxOutputLength exists', () => {
    expect(typeof getMaxOutputLength).toBe('function')
  })

  test('resolveDefaultShell: exists', () => {
    expect(typeof resolveDefaultShell).toBe('function')
  })

  test('shellToolUtils: isPowerShellToolEnabled and SHELL_TOOL_NAMES exported', () => {
    expect(typeof isPowerShellToolEnabled).toBe('function')
    expect(Array.isArray(SHELL_TOOL_NAMES)).toBe(true)
  })

  test('readOnlyCommandValidation: GIT_READ_ONLY_COMMANDS, validateFlags, FLAG_PATTERN exported', () => {
    expect(typeof GIT_READ_ONLY_COMMANDS).toBe('object')
    expect(typeof validateFlags).toBe('function')
    expect(FLAG_PATTERN).toBeInstanceOf(RegExp)
  })

  test('specPrefix: buildPrefix and DEPTH_RULES exported', () => {
    expect(typeof buildPrefix).toBe('function')
    expect(typeof DEPTH_RULES).toBe('object')
  })

  // ─── 依赖注入 ──────────────────────────────────────────────────────

  test('_deps: setGetPlatformFn and setWhichFn exist', () => {
    expect(typeof setGetPlatformFn).toBe('function')
    expect(typeof setWhichFn).toBe('function')
    expect(typeof setWindowsPathToPosixPathFn).toBe('function')
  })

  // ─── Phase 2: Provider 实现 ────────────────────────────────────────

  test('bashProvider: createBashShellProvider is a function', () => {
    expect(typeof createBashShellProvider).toBe('function')
  })

  test('powershellProvider: createPowerShellProvider and buildPowerShellArgs exist', () => {
    expect(typeof createPowerShellProvider).toBe('function')
    expect(typeof buildPowerShellArgs).toBe('function')
    expect(buildPowerShellArgs('echo hello')).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'echo hello'])
  })

  test('ShellSnapshot: createAndSaveSnapshot, createRipgrepShellIntegration, createFindGrepShellIntegration exist', () => {
    expect(typeof createAndSaveSnapshot).toBe('function')
    expect(typeof createRipgrepShellIntegration).toBe('function')
    expect(typeof createFindGrepShellIntegration).toBe('function')
  })

  // ─── 功能性 smoke test ────────────────────────────────────────────

  test('quote: can quote a simple argument', () => {
    const result = quote(['echo', 'hello world'])
    expect(typeof result).toBe('string')
  })

  test('tryParseShellCommand: can parse a simple command', () => {
    const result = tryParseShellCommand('echo hello')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.tokens.length).toBeGreaterThan(0)
    }
  })

  test('tryQuoteShellArgs: can quote args', () => {
    const result = tryQuoteShellArgs(['echo', 'hello world'])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.quoted).toContain('echo')
    }
  })

  test('quoteShellCommand: can quote a command', () => {
    const result = quoteShellCommand('echo "hello world"')
    expect(typeof result).toBe('string')
  })

  test('splitCommand_DEPRECATED: splits simple command', () => {
    const parts = splitCommand_DEPRECATED('echo hello world')
    expect(parts.length).toBeGreaterThan(0)
  })

  test('splitCommandWithOperators: splits with operators', () => {
    const parts = splitCommandWithOperators('echo hello && echo world')
    expect(parts.length).toBeGreaterThan(0)
  })

  test('isHelpCommand: detects --help', () => {
    expect(isHelpCommand('git --help')).toBe(true)
    expect(isHelpCommand('git status')).toBe(false)
  })

  test('containsHeredoc: detects non-heredoc', () => {
    expect(containsHeredoc('echo hello')).toBe(false)
  })

  test('shouldAddStdinRedirect: detects redirect', () => {
    const result = shouldAddStdinRedirect('echo hello')
    expect(typeof result).toBe('boolean')
  })

  test('getMaxOutputLength: returns a number', () => {
    const limit = getMaxOutputLength()
    expect(typeof limit).toBe('number')
    expect(limit).toBeGreaterThan(0)
  })

  test('validateFlags: is a function with correct signature', () => {
    expect(typeof validateFlags).toBe('function')
    expect(validateFlags.length).toBeGreaterThanOrEqual(3) // (tokens, startIndex, config, options?)
  })

  test('getCommandSpec: returns null for unknown command', async () => {
    const spec = await getCommandSpec('nonexistent_command_xyz')
    expect(spec).toBeNull()
  })

  test('buildPrefix: builds prefix for simple command', async () => {
    const result = await buildPrefix('echo', ['hello'], null)
    expect(typeof result).toBe('string')
  })

  // ─── Phase 3: 子进程环境 ───────────────────────────────────────────

  test('subprocessEnv: returns env object', () => {
    const env = subprocessEnv()
    expect(typeof env).toBe('object')
    expect(env).toHaveProperty('PATH')
  })

  test('registerUpstreamProxyEnvFn: is a function', () => {
    expect(typeof registerUpstreamProxyEnvFn).toBe('function')
  })

  // ─── Phase 3: ShellCommand ─────────────────────────────────────────

  test('wrapSpawn: is a function', () => {
    expect(typeof wrapSpawn).toBe('function')
  })

  test('createAbortedCommand: returns killed command', () => {
    const cmd = createAbortedCommand()
    expect(cmd.status).toBe('killed')
    expect(typeof cmd.cleanup).toBe('function')
  })

  test('createFailedCommand: returns completed command with error', () => {
    const cmd = createFailedCommand('test error')
    expect(cmd.status).toBe('completed')
  })

  // ─── Phase 3: Shell 发现 ──────────────────────────────────────────

  test('findSuitableShell: is a function', () => {
    expect(typeof findSuitableShell).toBe('function')
  })

  test('createProviderResolver: is a function', () => {
    expect(typeof createProviderResolver).toBe('function')
  })

  // ─── Phase 3: exec 核心 ──────────────────────────────────────────

  test('exec: is a function', () => {
    expect(typeof exec).toBe('function')
  })

  test('setCwd: is a function', () => {
    expect(typeof setCwd).toBe('function')
  })

  test('exec injection setters: exist', () => {
    expect(typeof setCreateTaskOutputFn).toBe('function')
    expect(typeof setGetSandboxTmpDirNameFn).toBe('function')
  })
})
