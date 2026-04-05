/**
 * @anthropic/shell — Shell 执行层公共 API
 *
 * 从 src/utils/bash/、src/utils/shell/ 提取的 Shell 解析、
 * 安全验证、Provider 等功能。
 *
 * Phase 1: bash 解析器 + 验证/配置 + 类型定义
 * Phase 2: bashProvider + powershellProvider + ShellSnapshot
 */

// ─── 类型 ──────────────────────────────────────────────────────────
export type {
  ShellType,
  ShellProvider,
  ShellConfig,
  ExecOptions,
  ExecResult,
  ShellCommand,
} from './types.js'
export {
  SHELL_TYPES,
  DEFAULT_HOOK_SHELL,
} from './types.js'

// ─── 依赖注入上下文 ─────────────────────────────────────────────────
export type { ShellExecContext, SnapshotContext } from './context.js'

// ─── bash 解析层 ───────────────────────────────────────────────────
export { quote, tryParseShellCommand, tryQuoteShellArgs, hasMalformedTokens, hasShellQuoteSingleQuoteBug, type ParseEntry, type ShellParseResult, type ShellQuoteResult } from './bash/shellQuote.js'
export { quoteShellCommand, shouldAddStdinRedirect, rewriteWindowsNullRedirect, hasStdinRedirect } from './bash/shellQuoting.js'
export { rearrangePipeCommand } from './bash/bashPipeCommand.js'
export { formatShellPrefixCommand } from './bash/shellPrefix.js'

// ─── bash AST / 解析器 ─────────────────────────────────────────────
export { parseCommand, parseCommandRaw, ensureInitialized, extractCommandArguments, PARSE_ABORTED, type Node, type ParsedCommandData } from './bash/parser.js'
export { SHELL_KEYWORDS } from './bash/bashParser.js'

// ─── bash 命令分析 ─────────────────────────────────────────────────
export {
  splitCommand_DEPRECATED,
  splitCommandWithOperators,
  filterControlOperators,
  isHelpCommand,
  isUnsafeCompoundCommand_DEPRECATED,
  extractOutputRedirections,
  getCommandSubcommandPrefix,
  clearCommandPrefixCaches,
} from './bash/commands.js'

// ─── bash 前缀提取 (静态，无 LLM 调用) ──────────────────────────────
export { getCommandPrefixStatic, getCompoundCommandPrefixesStatic } from './bash/prefix.js'

// ─── bash heredoc ──────────────────────────────────────────────────
export { extractHeredocs, restoreHeredocs, containsHeredoc, type HeredocInfo, type HeredocExtractionResult } from './bash/heredoc.js'

// ─── bash spec 注册表 ─────────────────────────────────────────────
export { getCommandSpec, loadFigSpec, type CommandSpec, type Argument, type Option } from './bash/registry.js'

// ─── bash tree-sitter 分析 ─────────────────────────────────────────
export {
  analyzeCommand,
  extractQuoteContext,
  extractCompoundStructure,
  extractDangerousPatterns,
  hasActualOperatorNodes,
  type QuoteContext,
  type CompoundStructure,
  type DangerousPatterns,
  type TreeSitterAnalysis,
} from './bash/treeSitterAnalysis.js'

// ─── Shell Provider 接口 ───────────────────────────────────────────
export type { ShellProvider as ShellProviderType } from './providers/shellProvider.js'
export { SHELL_TYPES as SHELL_PROVIDER_TYPES, DEFAULT_HOOK_SHELL as DEFAULT_HOOK_SHELL_PROVIDER } from './providers/shellProvider.js'

// ─── Shell Provider 实现 ───────────────────────────────────────────
export { createBashShellProvider } from './providers/bashProvider.js'
export { createPowerShellProvider, buildPowerShellArgs } from './providers/powershellProvider.js'

// ─── Shell 环境快照 ────────────────────────────────────────────────
export { createAndSaveSnapshot, createRipgrepShellIntegration, createFindGrepShellIntegration } from './bash/ShellSnapshot.js'

// ─── PowerShell 检测 ───────────────────────────────────────────────
export { findPowerShell, getCachedPowerShellPath, getPowerShellEdition, resetPowerShellCache, type PowerShellEdition } from './providers/powershellDetection.js'

// ─── 验证/安全 ────────────────────────────────────────────────────
export {
  GIT_READ_ONLY_COMMANDS,
  GH_READ_ONLY_COMMANDS,
  DOCKER_READ_ONLY_COMMANDS,
  RIPGREP_READ_ONLY_COMMANDS,
  PYRIGHT_READ_ONLY_COMMANDS,
  EXTERNAL_READONLY_COMMANDS,
  containsVulnerableUncPath,
  validateFlags,
  validateFlagArgument,
  FLAG_PATTERN,
  type FlagArgType,
  type ExternalCommandConfig,
} from './providers/readOnlyCommandValidation.js'

// ─── 配置 ──────────────────────────────────────────────────────────
export { getMaxOutputLength, BASH_MAX_OUTPUT_UPPER_LIMIT, BASH_MAX_OUTPUT_DEFAULT } from './providers/outputLimits.js'
export { resolveDefaultShell, setGetSettingsFn } from './providers/resolveDefaultShell.js'
export { isPowerShellToolEnabled, SHELL_TOOL_NAMES } from './providers/shellToolUtils.js'

// ─── 依赖注入设置 ──────────────────────────────────────────────────
export { setGetPlatformFn, setWhichFn, setWindowsPathToPosixPathFn } from './_deps.js'

// ─── 前缀提取 (spec-based) ─────────────────────────────────────────
export { buildPrefix, DEPTH_RULES } from './prefix/specPrefix.js'

// ─── Phase 3: 子进程环境 ───────────────────────────────────────────
export {
  registerUpstreamProxyEnvFn,
  subprocessEnv,
} from './subprocessEnv.js'

// ─── Phase 3: TaskOutputPort 接口 ──────────────────────────────────
export type { TaskOutputPort } from './taskOutputPort.js'

// ─── Phase 3: ShellCommand 实现 ───────────────────────────────────
export type { ShellCommandWithOutput } from './shellCommand.js'
export {
  wrapSpawn,
  createAbortedCommand,
  createFailedCommand,
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
} from './shellCommand.js'

// ─── Phase 3: Shell 发现 ──────────────────────────────────────────
export {
  findSuitableShell,
  createProviderResolver,
  createShellConfigFactory,
  createPsProviderFactory,
} from './shellDiscovery.js'

// ─── Phase 3: exec 核心 ──────────────────────────────────────────
export {
  exec,
  setCwd,
  setCreateTaskOutputFn,
  setGetSandboxTmpDirNameFn,
} from './exec.js'
