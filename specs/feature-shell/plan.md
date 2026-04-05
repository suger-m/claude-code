# Shell 执行层 - 详细实现计划

> 基于 `design.md` 和代码库实际调查编写
> 目标：将分散在 `src/utils/bash/`、`src/utils/shell/`、`src/utils/Shell.ts` 等处的 ~14,000 行 shell 相关代码提取为独立 `packages/shell` 包，通过依赖注入让 BashTool / PowerShellTool 使用

---

## 一、现状概览

### 当前代码分布

| 目录/文件 | 行数 | 职责 |
|-----------|------|------|
| `src/utils/bash/` (含 specs/) | ~11,619 | bash 命令解析 (AST/tree-sitter)、shell-quote 封装、命令分割、snapshot 创建、命令前缀提取、heredoc 处理、fig spec 注册表 |
| `src/utils/shell/` | ~1,178 | ShellProvider 接口定义、bashProvider / powershellProvider 实现、只读命令验证、命令前缀 Haiku 提取、PowerShell 检测、输出限制 |
| `src/utils/Shell.ts` | 474 | exec() 核心入口、shell 发现 (findSuitableShell)、sandbox 集成、spawn 管理、cwd 追踪 |
| `src/utils/ShellCommand.ts` | 465 | ShellCommand 抽象层、子进程生命周期管理、超时/中断处理、输出收集 (TaskOutput) |
| `src/utils/subprocessEnv.ts` | 99 | 子进程环境变量构建 (secret scrubbing, proxy injection) |
| `src/utils/permissions/shellRuleMatching.ts` | 228 | Shell 权限规则匹配 |
| **需搬迁总计** | **~14,063** | |

以下文件/目录 **不搬迁**，保留在 `src/` 中：

| 目录/文件 | 行数 | 理由 |
|-----------|------|------|
| `src/tools/BashTool/` (18 文件) | ~12,676 | 工具层，通过依赖注入使用 packages/shell |
| `src/tools/PowerShellTool/` (14 文件) | ~9,309 | 工具层，通过依赖注入使用 packages/shell |
| `src/components/shell/` (4 文件) | ~257 | UI 组件层 |
| `src/components/permissions/` (3 文件) | ~574 | 权限 UI 组件 |
| `src/components/tasks/` (2 文件) | ~299 | Shell 任务 UI |
| `src/tasks/LocalShellTask/` (3 文件) | ~768 | 任务管理与 UI 耦合 |
| `src/utils/promptShellExecution.ts` | 183 | Prompt 解析执行，与 prompt 系统耦合 |
| `src/utils/suggestions/shellHistoryCompletion.ts` | 119 | 补全建议，属于 UI 层 |

### 关键发现

1. **ShellProvider 接口已存在**: `src/utils/shell/shellProvider.ts` (33 行) 定义了 `ShellProvider` 接口，包含 `type`/`shellPath`/`detached`/`buildExecCommand()`/`getSpawnArgs()`/`getEnvironmentOverrides()`。
2. **BashProvider 和 PowerShellProvider 已实现**: `bashProvider.ts` (255 行) 和 `powershellProvider.ts` (123 行) 完整实现了 ShellProvider 接口。
3. **不存在 `packages/shell/` 目录**: design.md 中的目标包尚未创建。
4. **exec() 是核心调度器**: `Shell.ts` 的 `exec()` 通过 `resolveProvider` 字典选择 bash/powershell provider，管理 spawn、sandbox、CWD 追踪全流程。
5. **BashTool/PowerShellTool 直接调用 exec()**: 两个 Tool 均调用 `src/utils/Shell.ts` 的 `exec()`，后者内部使用 provider。
6. **bash 解析层体量最大**: `bashParser.ts` (4,436 行) + `ast.ts` (2,679 行) + `commands.ts` (1,339 行) 共 8,454 行，包含 tree-sitter 解析器。
7. **外部依赖耦合深**: exec() 直接依赖 bootstrap/state、sandbox manager、hooks 系统、analytics、sessionEnvironment 等约 15 个外部模块。

---

## 二、目标结构

```
packages/shell/
  package.json                    # workspace:* 引用
  tsconfig.json
  src/
    index.ts                      # 公共导出
    types.ts                      # ShellProvider, ShellType, ExecResult, ShellCommand 等类型

    # 核心执行层
    exec.ts                       # exec() 入口函数
    shellDiscovery.ts             # findSuitableShell(), getShellConfig()
    shellCommand.ts               # ShellCommand 实现 (wrapSpawn 等)
    subprocessEnv.ts              # 子进程环境变量
    context.ts                    # ShellExecContext 接口 (依赖注入)

    # Provider 实现
    providers/
      shellProvider.ts            # ShellProvider 接口
      bashProvider.ts             # Bash/Zsh provider
      powershellProvider.ts       # PowerShell provider
      powershellDetection.ts      # PowerShell 路径检测

    # Bash 解析/安全
    bash/
      shellSnapshot.ts            # Shell 环境快照
      shellQuote.ts               # POSIX shell 引号处理
      shellQuoting.ts             # 命令引用 (Windows null 重写等)
      shellPrefix.ts              # CLAUDE_CODE_SHELL_PREFIX 格式化
      commands.ts                 # 命令分割
      ast.ts                      # AST 安全分析
      parser.ts                   # tree-sitter parser 初始化
      bashParser.ts               # Bash parser 实现 (4,436 行)
      treeSitterAnalysis.ts       # tree-sitter 分析工具
      parsedCommand.ts            # 解析后命令数据
      heredoc.ts                  # Heredoc 处理
      bashPipeCommand.ts          # 管道命令重排
      prefix.ts                   # Bash 命令前缀提取
      shellCompletion.ts          # Shell 补全
      registry.ts                 # Fig spec 注册表
      specs/                      # 命令规格定义 (7 文件, 213 行)

    # 前缀提取 (shell 无关)
    prefix/
      specPrefix.ts               # Fig-spec 驱动前缀
      llmPrefix.ts                # Haiku LLM 前缀提取器

    # 验证
    validation/
      readOnlyCommandValidation.ts # 只读命令验证
      outputLimits.ts             # 输出长度限制

    # 配置
    config/
      resolveDefaultShell.ts      # 默认 shell 解析
      shellToolUtils.ts           # PowerShellTool 运行时门控
```

---

## 三、依赖注入接口设计

packages/shell 需要从 src/ 解耦的核心外部依赖通过 `ShellExecContext` 接口注入：

```typescript
/**
 * packages/shell 对外部运行时环境的依赖接口。
 * 由 src/ 侧适配器实现，传入 packages/shell 的函数中。
 */
export interface ShellExecContext {
  // --- CWD 管理 ---
  getCwd(): string
  setCwd(path: string): void
  getOriginalCwd(): string

  // --- 会话 ---
  getSessionId(): string

  // --- 日志 ---
  logEvent(name: string, data: Record<string, unknown>): void
  logForDebugging(msg: string): void

  // --- 会话环境 ---
  getSessionEnvVars(): Iterable<[string, string]>
  getSessionEnvironmentScript(): Promise<string>

  // --- 沙盒 ---
  wrapWithSandbox?(cmd: string, shell: string, tmpDir: string | undefined, signal: AbortSignal): Promise<string>
  cleanupAfterSandbox?(): void

  // --- CWD 变更回调 ---
  onCwdChanged?(oldCwd: string, newCwd: string): Promise<void>

  // --- Tmux 隔离 ---
  getTmuxEnv?(): string | null
  ensureTmuxSocket?(): Promise<void>
  hasTmuxToolBeenUsed?(): boolean

  // --- 上游代理 ---
  registerUpstreamProxyEnvFn?(fn: () => Record<string, string>): void
  getUpstreamProxyEnv?(): Record<string, string>
}
```

---

## 四、模块状态与工作项

### 模块 1: packages/shell 包骨架

**当前状态**: 未实现

**需要做的工作**:
- 创建 `packages/shell/` 目录结构
- 创建 `package.json`，配置 `"name": "@anthropic/shell"`，`"exports"` 字段暴露公共 API
- 创建 `tsconfig.json`，继承根配置或独立配置
- 更新根 `package.json` 的 workspaces 配置确认包含 `packages/shell`
- 验证 Bun workspace 解析正常 (`bun install`)

**依赖关系**: 无前置依赖

**风险**:
- Bun workspace 中 TypeScript 路径解析需要测试
- `bun:bundle` feature flag 在 packages/ 中的可用性需要验证

---

### 模块 2: 类型与接口提取

**当前状态**: 部分实现 — ShellProvider 接口已存在于 `shellProvider.ts`，ExecResult/ShellCommand 已存在于 `ShellCommand.ts`，ExecOptions 已存在于 `Shell.ts`

**需要做的工作**:
- 将以下类型集中到 `packages/shell/src/types.ts`:
  - `ShellType`, `SHELL_TYPES`, `DEFAULT_HOOK_SHELL` (来自 `shellProvider.ts`)
  - `ShellProvider` 接口 (来自 `shellProvider.ts`)
  - `ShellConfig` (来自 `Shell.ts`)
  - `ExecResult`, `ShellCommand` (来自 `ShellCommand.ts`)
  - `ExecOptions` (来自 `Shell.ts`)
- 将 `ShellExecContext` 接口定义在 `packages/shell/src/context.ts`
- 确保类型文件不依赖 `src/` 中的任何模块

**依赖关系**: 依赖模块 1

**风险**: 低，纯类型搬迁

---

### 模块 3: ShellProvider 实现迁移

**当前状态**: 已实现

| 文件 | 行数 | 现状 |
|------|------|------|
| `src/utils/shell/shellProvider.ts` | 33 | ShellProvider 接口定义 |
| `src/utils/shell/bashProvider.ts` | 255 | Bash/Zsh provider 实现 |
| `src/utils/shell/powershellProvider.ts` | 123 | PowerShell provider 实现 |
| `src/utils/shell/powershellDetection.ts` | 107 | PowerShell 路径检测 (pwsh/powershell 查找、snap 规避) |
| `src/utils/shell/shellToolUtils.ts` | 22 | PowerShellTool 运行时门控 |

**需要做的工作**:
- 搬迁 `shellProvider.ts` → `providers/shellProvider.ts`
- 搬迁 `powershellDetection.ts` → `providers/powershellDetection.ts`
- 搬迁 `powershellProvider.ts` → `providers/powershellProvider.ts`
  - 解耦 `sessionEnvVars` 依赖：通过 ShellExecContext 注入
- 搬迁 `bashProvider.ts` → `providers/bashProvider.ts`
  - 解耦 `tmuxSocket` 依赖：通过 ShellExecContext 注入
  - 解耦 `sessionEnvironment` 依赖：通过 ShellExecContext 注入
  - 解耦 `sessionEnvVars` 依赖：通过 ShellExecContext 注入
  - 解耦 `shellPrefix`、`shellQuote`、`shellQuoting`、`bashPipeCommand` 依赖：已在同 package 中
- 搬迁 `shellToolUtils.ts` → `config/shellToolUtils.ts`
- 更新所有内部导入路径

**消费方** (导入这些模块的文件):
- `src/utils/Shell.ts` — 导入 bashProvider, powershellDetection, powershellProvider, shellProvider
- `src/tools/PowerShellTool/PowerShellTool.tsx` — 导入 powershellDetection
- `src/tools/BashTool/readOnlyValidation.ts` — 间接依赖
- `src/tools/PowerShellTool/` (多个文件) — 间接依赖

**依赖关系**: 依赖模块 2

**风险**:
- 中等：bashProvider 的外部依赖需要通过接口注入
- `bun:bundle` 的 `feature()` 调用在 bashProvider 中使用 (`feature('COMMIT_ATTRIBUTION')`)，需验证跨包可用

---

### 模块 4: Bash 解析器迁移

**当前状态**: 已实现 (共 ~11,619 行)

| 文件 | 行数 | 外部依赖 |
|------|------|----------|
| `bashParser.ts` | 4,436 | tree-sitter WASM/native 模块 |
| `ast.ts` | 2,679 | bashParser (内部), `feature()` flag |
| `commands.ts` | 1,339 | shellQuote, heredoc, ParsedCommand (内部) |
| `treeSitterAnalysis.ts` | 506 | parser (内部) |
| `ParsedCommand.ts` | 318 | bashParser (内部) |
| `heredoc.ts` | 733 | 无外部依赖 |
| `shellQuote.ts` | 304 | `shell-quote` npm 包 |
| `bashPipeCommand.ts` | 294 | shellQuoting (内部) |
| `prefix.ts` | 204 | registry, parser, ast (内部) |
| `parser.ts` | 230 | bashParser (内部) |
| `shellCompletion.ts` | 259 | registry (内部) |
| `shellQuoting.ts` | 128 | 无外部依赖 |
| `shellPrefix.ts` | 28 | shellQuote (内部) |
| `registry.ts` | 53 | `@withfig/autocomplete` |
| `specs/*.ts` | 213 | 无外部依赖 |

**需要做的工作**:
- 将 `src/utils/bash/` 整体搬迁到 `packages/shell/src/bash/`
- 更新所有内部导入路径
- 处理 tree-sitter WASM/native 模块加载路径：`bashParser.ts` 使用动态 `import()` 加载，迁移后相对路径变化
- 处理 `@withfig/autocomplete` 动态 import 路径（应不受影响，因为是 node_modules 依赖）
- 处理 `feature('COMMIT_ATTRIBUTION')` 调用

**消费方** (导入 bash 模块的文件):
- `src/tools/BashTool/BashTool.tsx` — 导入 ast, commands
- `src/tools/BashTool/bashSecurity.ts` — 导入 ast, commands
- `src/tools/BashTool/bashPermissions.ts` — 导入 commands
- `src/tools/BashTool/readOnlyValidation.ts` — 导入 commands
- `src/tools/BashTool/pathValidation.ts` — 导入 commands
- `src/tools/BashTool/sedValidation.ts` — 导入 commands
- `src/tools/BashTool/sedEditParser.ts` — 导入 shellQuote
- `src/tools/BashTool/bashCommandHelpers.ts` — 导入 commands
- `src/tools/BashTool/commandSemantics.ts` — 导入 commands
- `src/tools/BashTool/modeValidation.ts` — 导入 commands
- `src/tools/BashTool/shouldUseSandbox.ts` — 导入 commands
- `src/components/permissions/BashPermissionRequest/` — 导入 commands, prefix
- `src/hooks/useTypeahead.tsx` — 导入 shellCompletion
- `src/utils/swarm/backends/PaneBackendExecutor.ts` — 导入 commands
- `src/tools/shared/spawnMultiAgent.ts` — 导入 commands
- `src/commands/clear/caches.ts` — 导入 commands
- `src/utils/shell/bashProvider.ts` — 导入 shellPrefix, ShellSnapshot, shellQuote, shellQuoting, bashPipeCommand
- `src/utils/shell/specPrefix.ts` — 导入 registry

**依赖关系**: 依赖模块 1

**风险**:
- **高风险**: tree-sitter native 模块路径在 package 移动后可能无法正确加载
- **高风险**: `feature()` flag 调用跨包可用性
- 中等：18 个消费文件的导入路径需要更新

---

### 模块 5: Shell Snapshot 迁移

**当前状态**: 已实现 (582 行)

**需要做的工作**:
- 搬迁 `src/utils/bash/ShellSnapshot.ts` → `packages/shell/src/bash/shellSnapshot.ts`
- 解耦外部依赖:
  - `src/services/analytics/` (logEvent) → 通过 ShellExecContext 注入或 no-op 默认
  - `src/utils/embeddedTools.js` (hasEmbeddedSearchTools, embeddedSearchToolsBinaryPath) → 通过参数注入
  - `src/utils/ripgrep.js` (ripgrepCommand) → 通过参数注入
  - `src/utils/cleanupRegistry.js` (registerCleanup) → 通过回调注入
- 快照文件输出目录从 `~/.claude/shell-snapshots/` 改为通过参数配置

**依赖关系**: 依赖模块 4 (依赖 shellQuote)

**风险**:
- 中等：依赖链较长，涉及 ripgrep 嵌入工具检测和 Bun argv0 分发技巧
- `createArgv0ShellFunction` 中的 Bun 特定逻辑在 package 中需要保持兼容

---

### 模块 6: 前缀提取器迁移

**当前状态**: 已实现

| 文件 | 行数 | 外部依赖 |
|------|------|----------|
| `src/utils/shell/specPrefix.ts` | 241 | registry (内部) |
| `src/utils/shell/prefix.ts` | 367 | queryHaiku (API 调用), analytics |

**需要做的工作**:
- 搬迁 `specPrefix.ts` → `packages/shell/src/prefix/specPrefix.ts` (简单搬迁，依赖已在同 package 中)
- 搬迁 `prefix.ts` → `packages/shell/src/prefix/llmPrefix.ts`
  - 解耦 `queryHaiku` API 调用：通过回调参数注入
  - 解耦 analytics (logEvent)：通过 ShellExecContext 注入
- 搬迁 `src/utils/bash/prefix.ts` → `packages/shell/src/bash/prefix.ts` (已在模块 4 中)

**依赖关系**: 依赖模块 4

**风险**:
- 中等：llmPrefix.ts 的 API 依赖需要通过回调注入
- 低：specPrefix.ts 几乎无外部依赖

---

### 模块 7: 验证与配置迁移

**当前状态**: 已实现

| 文件 | 行数 | 外部依赖 |
|------|------|----------|
| `src/utils/shell/outputLimits.ts` | 14 | envValidation (小工具) |
| `src/utils/shell/resolveDefaultShell.ts` | 14 | settings |
| `src/utils/shell/shellToolUtils.ts` | 22 | envUtils, platform |

**需要做的工作**:
- 搬迁 `outputLimits.ts` → `packages/shell/src/validation/outputLimits.ts`
- 搬迁 `resolveDefaultShell.ts` → `packages/shell/src/config/resolveDefaultShell.ts`
  - 解耦对 `src/utils/settings/settings.js` 的依赖：通过参数传入 defaultShell 值
- 搬迁 `shellToolUtils.ts` → `packages/shell/src/config/shellToolUtils.ts`
  - 保留 `getPlatform()` 和 `isEnvTruthy` 作为内部工具

**依赖关系**: 依赖模块 1

**风险**: 低，这些文件独立性强

---

### 模块 8: exec 核心迁移

**当前状态**: 已实现

| 文件 | 行数 | 外部依赖数量 |
|------|------|-------------|
| `src/utils/Shell.ts` | 474 | ~15 个外部模块 |
| `src/utils/ShellCommand.ts` | 465 | ~5 个外部模块 |
| `src/utils/subprocessEnv.ts` | 99 | ~3 个外部模块 |

这是整个搬迁中**最复杂的部分**。

**需要做的工作**:

8a. **subprocessEnv.ts** → `packages/shell/src/subprocessEnv.ts`
- 解耦 `envUtils` (isEnvTruthy): 内联或复制
- 解耦 `registerUpstreamProxyEnvFn` 的注册机制: 通过 ShellExecContext 注入

8b. **ShellCommand.ts** → `packages/shell/src/shellCommand.ts`
- 解耦 `TaskOutput` (磁盘输出管理): 通过接口抽象或参数传入
- 解耦 `formatDuration`, `MAX_TASK_OUTPUT_BYTES`: 复制小工具函数
- 解耦 `tree-kill`: 保留为 npm 依赖
- 解耦 `generateTaskId`: 通过参数传入或接口

8c. **Shell.ts** → `packages/shell/src/exec.ts` + `packages/shell/src/shellDiscovery.ts`
- 拆分 `findSuitableShell()` 和 `getShellConfig()` 到 `shellDiscovery.ts`
- 拆分 `exec()` 到 `exec.ts`
- 通过 ShellExecContext 解耦所有外部依赖:
  - `bootstrap/state.js` (getSessionId, getOriginalCwd, setCwdState)
  - `sandbox/sandbox-adapter.js` (SandboxManager.wrapWithSandbox)
  - `hooks/fileChangedWatcher.js` (onCwdChangedForHooks)
  - `sessionEnvironment.js` (getSessionEnvironmentScript)
  - `sessionEnvVars.js` (getSessionEnvVars)
  - `analytics/index.js` (logEvent)
  - `debug.js` (logForDebugging)
  - `task/diskOutput.js` (getTaskOutputDir)
  - `task/TaskOutput.js` (TaskOutput 类)
  - `windowsPaths.js` (posixPathToWindowsPath, windowsPathToPosixPath)
  - `permissions/filesystem.js` (getClaudeTempDirName)
  - `platform.js` (getPlatform)
  - `which.js` (which)
  - `hooks.js` (onCwdChangedForHooks)

**消费方**:
- `src/tools/BashTool/BashTool.tsx` — 调用 `exec()`
- `src/tools/PowerShellTool/PowerShellTool.tsx` — 调用 `exec()`
- `src/utils/promptShellExecution.ts` — 调用 `exec()`
- `src/utils/hooks.ts` — 使用 ShellCommand 类型
- `src/screens/Doctor.tsx` — 检查 shell 可用性
- `src/tools.ts` — shell tool 注册
- `src/utils/streamlinedTransform.ts` — shell 相关
- `src/services/compact/` — shell 相关
- `src/schemas/hooks.ts` — Shell type 引用
- `src/constants/tools.ts` — shell tool 名称

**依赖关系**: 依赖模块 3 (providers)

**风险**:
- **高风险**: exec() 与 15+ 个外部模块耦合，是解耦难度最大的部分
- **高风险**: TaskOutput 的磁盘 I/O 机制深度嵌入 ShellCommand，解耦不当可能影响输出可靠性
- 中等：CWD 管理的同步性要求 (readFileSync + unlinkSync 在 .then() 中必须同步完成)

---

### 模块 9: 消费方适配

**当前状态**: 未实现

**需要做的工作**:
9a. 在 `src/` 中创建适配层:
- 创建 `src/utils/shellBridge.ts`，实现 `ShellExecContext` 接口，桥接 src/ 侧的实际实现
- 该文件作为 packages/shell 和 src/ 之间的胶水层

9b. 更新所有消费文件的导入路径:
- 18 个导入 `utils/bash/` 的文件
- 13 个导入 `utils/shell/` 的文件
- 8 个使用 `subprocessEnv` 的文件 (init.ts, hooks.ts, mcp/client.ts, lsp/LSPClient.ts, Shell.ts, subprocessEnv.ts, ShellSnapshot.ts, upstreamproxy.ts)

9c. 过渡策略:
- 可在 `src/utils/bash/` 和 `src/utils/shell/` 创建 index.ts re-export 文件
- 让消费方逐步迁移，避免一次性大改

**依赖关系**: 依赖所有前置模块

**风险**:
- 中等：导入路径变更量大 (30+ 文件)，但机械性工作
- 需要确保 `bun run build` 和 `bun run dev` 都能正确解析 workspace 包

---

### 模块 10: 测试迁移与补充

**当前状态**: 部分测试存在

**现有测试文件**:
- `src/utils/shell/__tests__/outputLimits.test.ts`
- `src/tools/PowerShellTool/__tests__/` (4 个测试文件)
- `src/utils/permissions/__tests__/shellRuleMatching.test.ts`

**需要做的工作**:
- 将 outputLimits 测试迁移到 packages/shell
- 更新引用 shell 模块的现有测试文件的导入路径
- 补充单元测试:
  - ShellProvider 接口的 mock 测试
  - bashProvider / powershellProvider 的集成测试
  - 命令解析器的回归测试
  - snapshot 创建的 mock 测试
- 运行全量 `bun test` 确保无回归

**依赖关系**: 依赖模块 9

**风险**: 中等 — tree-sitter 和子进程 spawn 的 mock 复杂度高

---

## 五、执行优先级排序

| 优先级 | 模块 | 工作量 | 风险 | 理由 |
|--------|------|--------|------|------|
| P0 | 模块 1: packages/shell 包骨架 | 0.5 天 | 低 | 所有后续工作的基础 |
| P0 | 模块 2: 类型与接口提取 | 0.5 天 | 低 | 确立公共 API 契约 |
| P1 | 模块 7: 验证与配置迁移 | 1 天 | 低 | 低风险、高独立性 |
| P1 | 模块 3: ShellProvider 迁移 | 2 天 | 中 | 核心抽象层 |
| P2 | 模块 4: Bash 解析器迁移 | 3 天 | 高 | 最大模块，tree-sitter 路径问题 |
| P2 | 模块 5: Shell Snapshot 迁移 | 1 天 | 中 | 依赖解析器 |
| P2 | 模块 6: 前缀提取器迁移 | 1 天 | 中 | API 依赖需注入 |
| P2 | 模块 8: exec 核心迁移 | 3 天 | 高 | 与 sandbox/cwd 紧耦合 |
| P3 | 模块 9: 消费方适配 | 2 天 | 中 | 最后统一修改 |
| P3 | 模块 10: 测试迁移与补充 | 2 天 | 中 | 功能稳定后补充 |

**总预估工作量**: ~16 天

---

## 六、关键风险与难点

### 高风险

1. **tree-sitter 模块加载路径**: `bashParser.ts` (4,436 行) 使用动态 `import()` 加载 tree-sitter WASM/native 模块。迁移到 `packages/shell/` 后，相对路径会变化。该模块使用两种加载模式（native `.node` 和 WASM），路径解析逻辑复杂。

2. **exec() 与状态系统的深度耦合**: `Shell.ts` 的 `exec()` 直接依赖 15+ 个外部模块（bootstrap/state 全局单例、sandbox manager、hooks 文件监听、analytics 等），完全解耦需要精心设计 ShellExecContext 接口。

3. **TaskOutput 与 ShellCommand 的紧耦合**: `ShellCommand.ts` 深度依赖 `TaskOutput` 类（磁盘输出、文件描述符管理、进度回调）。TaskOutput 自身有 20+ 个方法和属性，通过接口解耦工作量较大。

4. **`bun:bundle` feature flag 跨包可用性**: `bashProvider.ts` 和 `ast.ts` 使用 `feature('COMMIT_ATTRIBUTION')` 等 feature flag。这些 flag 依赖 Bun 运行时的 define 注入机制，在 packages/ 子包中可能无法正常解析。

### 中等风险

5. **CWD 追踪的同步性**: `Shell.ts` 在 `.then()` 回调中使用 `readFileSync` + `unlinkSync` 同步读取 CWD 临时文件，注释明确说明"必须同步完成"。搬迁时需保持这一时序约束。

6. **subprocessEnv 的懒加载注册**: `registerUpstreamProxyEnvFn()` 在 `init.ts` 中调用，将 proxy 环境注入到后续所有子进程。搬迁后需保持此注册路径可用。

7. **ShellSnapshot 的 ripgrep 嵌入逻辑**: `ShellSnapshot.ts` 包含 ripgrep 别名/函数生成逻辑，依赖 `embeddedTools.js` 和 `ripgrep.js` 判断是否使用嵌入的 ripgrep。这些判断逻辑在 package 中需要保持正确。

8. **30+ 个消费文件的导入更新**: 涉及 BashTool (18 文件)、PowerShellTool (14 文件) 和其他工具文件。虽然机械但量大易出错。

### 低风险

9. **fig spec 动态加载**: `registry.ts` 使用 `import(@withfig/autocomplete/build/${command}.js)` 动态加载，由于 `@withfig/autocomplete` 是 node_modules 依赖，迁移后路径不受影响。

10. **readOnlyCommandValidation**: 相对独立，仅依赖 `platform.ts`。

---

## 七、建议的实施策略

1. **渐进式迁移**: 先搬迁低风险模块（类型、配置、验证），验证 workspace 解析正常后，再搬迁核心模块。

2. **保留 re-export 过渡层**: 在 `src/utils/bash/` 和 `src/utils/shell/` 创建 index.ts re-export 文件，让消费方暂时不受影响。逐步替换导入路径后再删除 re-export。

3. **exec() 拆分策略**: 将 `exec()` 拆分为两层：
   - **纯逻辑层** (packages/shell): provider 选择、命令构建、spawn 调用
   - **状态管理层** (src/ 适配器): CWD 更新、sandbox 包装、session 状态注入

4. **每步验证**: 每完成一个模块的迁移后立即运行 `bun test` 和 `bun run build`。

5. **分批提交**: 每完成一个模块就提交一次，便于回滚。

---

## 八、验收标准

1. `packages/shell/` 可独立导入，不直接依赖 `src/` 中的模块（仅通过 ShellExecContext 接口交互）
2. `bun test` 全部通过，无回归
3. `bun run build` 成功，产物中包含 packages/shell 的代码
4. `bun run dev` 中 Bash 工具和 PowerShell 工具正常工作
5. `bun run lint` 通过
6. 所有 `src/utils/bash/` 和 `src/utils/shell/` 中的文件已被删除或改为 re-export（过渡期）
7. tree-sitter 解析在新位置正常工作（AST 分析、命令分割功能正常）
8. 沙盒模式在新位置正常工作
9. Windows (PowerShell) 和 macOS/Linux (Bash/Zsh) 平台均正常
