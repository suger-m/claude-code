# IDE / 编辑器集成 — 实施计划

> 基于 `design.md` 及代码库实际调查
> 日期: 2026-04-05

## 一、概述

设计文档提议将分散在 `src/utils/ide.ts`、`src/utils/jetbrains.ts`、`src/services/lsp/`、`src/utils/claudeInChrome/` 等 7+ 个位置的 IDE 集成代码统一迁移至 `packages/ide/` 单体包。当前各模块功能独立、完整度各异，需要评估每个模块的实现状态并规划整合工作。

---

## 二、模块现状与详细工作

### 2.1 IDE 检测与连接 (`src/utils/ide.ts`)

**当前状态**: 已实现（完整）

**文件**: `src/utils/ide.ts`（~1495 行）

**功能清单**:
- 18 种 IDE 类型定义（`IdeType`）：VSCode、Cursor、Windsurf、IntelliJ、PyCharm、WebStorm 等
- IDE 进程检测：macOS/Windows/Linux 三平台 `ps`/`tasklist` 扫描
- Lockfile 发现与解析：`~/.claude/ide/*.lock` 文件读取、端口提取、workspace 匹配
- IDE 连接管理：`findAvailableIDE()`（轮询 30s）、`detectIDEs()`、`maybeNotifyIDEConnected()`
- 扩展安装：VSCode `--install-extension`、版本比较、Artifactory 内部分发
- WSL 跨平台支持：Windows/WSL 路径转换、`detectHostIP()`、`checkWSLDistroMatch()`
- Stale lockfile 清理：`cleanupStaleIdeLockfiles()`
- 终端环境检测：`isSupportedTerminal()`、`isSupportedVSCodeTerminal()`、`isSupportedJetBrainsTerminal()`
- 初始化流程：`initializeIdeIntegration()` — 检测 + 自动安装 + onboarding

**迁移工作**:
- 将整个文件迁移至 `packages/ide/src/detection.ts`
- 拆分为子模块：`types.ts`（IdeType、配置映射）、`detection.ts`（进程检测）、`connection.ts`（连接管理）、`installation.ts`（扩展安装）、`wsl.ts`（WSL 特化逻辑）
- 更新所有 import 路径（约 30+ 处引用）

**依赖关系**: 被 `src/commands/ide/ide.tsx`、`src/hooks/notifs/useIDEStatusIndicator.tsx`、`src/hooks/useIdeConnectionStatus.ts`、`src/hooks/useIdeSelection.ts`、`src/main.tsx` 等大量文件引用

**风险**:
- 文件体量大（~1495 行），拆分时需注意循环依赖
- WSL 路径转换逻辑（`idePathConversion.ts`）需要一起迁移
- `require('src/components/IdeOnboardingDialog.js')` 的 lazy import 在 monorepo 中需要调整

---

### 2.2 JetBrains 插件检测 (`src/utils/jetbrains.ts`)

**当前状态**: 已实现（完整）

**文件**: `src/utils/jetbrains.ts`（~192 行）

**功能清单**:
- 14 种 JetBrains IDE 目录模式映射
- 三平台插件目录路径构建（macOS/Windows/Linux）
- 插件存在性检测：`isJetBrainsPluginInstalled()`（遍历目录查找 `claude-code-jetbrains-plugin`）
- 带缓存的检测：`isJetBrainsPluginInstalledCached()`、`isJetBrainsPluginInstalledCachedSync()`

**迁移工作**:
- 合并至 `packages/ide/src/jetbrains.ts`（可作为独立子模块）
- 更新 import 路径（被 `src/utils/ide.ts`、`src/utils/statusNoticeDefinitions.tsx`、`src/hooks/notifs/useIDEStatusIndicator.tsx` 引用）

**依赖关系**: 依赖 `src/utils/fsOperations.js`、`src/utils/ide.ts`（`IdeType` 类型）

**风险**: 低风险，模块边界清晰

---

### 2.3 IDE 命令 UI (`src/commands/ide/ide.tsx`)

**当前状态**: 已实现（完整）

**文件**: `src/commands/ide/ide.tsx`（~631 行）

**功能清单**:
- `/ide` 命令处理：IDE 选择 UI（`IDEScreen`）、连接流程（`IDECommandFlow`）
- `/ide open` 子命令：在 IDE 中打开项目
- IDE 扩展安装 UI：`RunningIDESelector`、`InstallOnMount`
- 连接超时管理（35s）
- 动态 MCP 配置管理（`sse-ide`/`ws-ide` 类型）

**迁移工作**:
- 迁移至 `packages/ide/src/commands/ide.tsx`
- 依赖 React/Ink 组件（`Dialog`、`Select`、`Text`），需要保留对 `src/components/` 和 `src/ink.js` 的引用

**依赖关系**: 依赖 `src/utils/ide.ts`、`src/state/AppState.tsx`、`src/services/mcp/client.ts`、UI 组件库

**风险**: 中等风险 — UI 组件依赖路径在 monorepo 中需要仔细处理

---

### 2.4 LSP 服务层 (`src/services/lsp/`)

**当前状态**: 已实现（完整，8 个文件）

**文件列表**:
| 文件 | 行数 | 功能 |
|------|------|------|
| `LSPClient.ts` | ~447 | JSON-RPC 连接管理，进程生命周期 |
| `LSPServerInstance.ts` | ~512 | 单服务器实例管理，状态机，重试逻辑 |
| `LSPServerManager.ts` | ~420 | 多服务器管理，文件扩展名路由，文件同步 |
| `LSPDiagnosticRegistry.ts` | ~387 | 诊断信息注册/去重/限流/投递 |
| `manager.ts` | ~290 | 全局单例，初始化/重初始化/关闭 |
| `config.ts` | ~80 | 从插件加载 LSP 服务器配置 |
| `types.ts` | ~5 | 类型存根（`any`） |
| `passiveFeedback.ts` | - | 诊断通知处理器 |

**功能清单**:
- 完整的 LSP 客户端实现（基于 `vscode-jsonrpc`）
- 服务器生命周期管理（启动/停止/重启/崩溃恢复）
- 文件同步（didOpen/didChange/didSave/didClose）
- 诊断信息去重（跨 turn LRU 缓存）和限流（10/文件、30/总计）
- 通过插件系统配置 LSP 服务器
- 支持的 LSP 操作：goToDefinition、findReferences、hover、documentSymbol、workspaceSymbol、goToImplementation、callHierarchy

**迁移工作**:
- 将整个 `src/services/lsp/` 目录迁移至 `packages/ide/src/services/lsp/`
- 更新 `src/tools/LSPTool/LSPTool.ts` 的 import 路径
- 更新 `src/main.tsx` 中的 `initializeLspServerManager()` 调用

**依赖关系**: 被 `src/tools/LSPTool/` 引用；依赖 `vscode-jsonrpc`、`vscode-languageserver-protocol`、`vscode-languageserver-types`

**风险**:
- `types.ts` 仍是 `any` 存根，需要补充真实类型
- `config.ts` 依赖插件系统（`src/utils/plugins/`），需要在包之间建立清晰的接口

---

### 2.5 LSPTool (`src/tools/LSPTool/`)

**当前状态**: 已实现（完整，7 个文件）

**文件列表**: `LSPTool.ts`、`UI.tsx`、`prompt.ts`、`schemas.ts`、`formatters.ts`、`symbolContext.ts`、`__tests__/`

**迁移工作**:
- 这个工具是 Tool 系统的一部分，应留在 `src/tools/` 中
- 但需要更新对 `packages/ide/src/services/lsp/` 的 import 路径

**风险**: 低风险，仅 import 路径变更

---

### 2.6 Claude-in-Chrome (`src/utils/claudeInChrome/`)

**当前状态**: 已实现（完整，7 个核心文件）

**文件列表**:
| 文件 | 行数 | 功能 |
|------|------|------|
| `common.ts` | ~541 | 浏览器检测/配置、Native Messaging 路径、socket 管理 |
| `setup.ts` | ~401 | MCP 服务器配置、Native Host manifest 安装、扩展检测 |
| `mcpServer.ts` | ~294 | Chrome MCP 服务器运行、context 创建、bridge URL |
| `prompt.ts` | ~84 | Chrome 工具的系统提示词 |
| `chromeNativeHost.ts` | ~528 | Chrome Native Host 纯 TypeScript 实现 |
| `setupPortable.ts` | - | 可移植的扩展检测逻辑 |
| `toolRendering.tsx` | - | Chrome 工具 UI 渲染 |

**功能清单**:
- 7 种 Chromium 浏览器支持（Chrome、Brave、Arc、Edge、Chromium、Vivaldi、Opera）
- Native Messaging Host 安装（macOS/Linux 文件 + Windows 注册表）
- Bridge 模式（WebSocket 连接到 `bridge.claudeusercontent.com`）
- 扩展检测（扫描浏览器 Extensions 目录）
- MCP 服务器（stdio transport，通过 `@ant/claude-for-chrome-mcp`）
- 系统提示词注入

**迁移工作**:
- 迁移至 `packages/ide/src/chrome/` 子目录
- 更新 CLI 入口中的 `--claude-in-chrome-mcp` 和 `--chrome-native-host` 路径
- 更新 `src/commands/chrome/chrome.tsx` 的 import

**依赖关系**: 依赖 `@ant/claude-for-chrome-mcp` 包；被 `src/entrypoints/cli.tsx`、`src/main.tsx`、`src/context.ts` 引用

**风险**:
- Native Host 的 wrapper script 路径在 monorepo 中可能需要调整
- Bridge URL 配置涉及 OAuth token，需要确保路径正确

---

### 2.7 Chrome 命令 UI (`src/commands/chrome/chrome.tsx`)

**当前状态**: 已实现（完整）

**文件**: `src/commands/chrome/chrome.tsx`（~241 行）

**功能**: `/chrome` 命令 UI — 安装扩展、管理权限、重新连接、切换默认启用

**迁移工作**: 迁移至 `packages/ide/src/commands/chrome.tsx`

**风险**: 低风险

---

### 2.8 IDE 状态 Hooks

**当前状态**: 已实现（完整）

**文件列表**:
| 文件 | 功能 |
|------|------|
| `src/hooks/notifs/useIDEStatusIndicator.tsx` | IDE 连接状态通知（断开/安装失败/JetBrains 提示） |
| `src/hooks/useIdeConnectionStatus.ts` | IDE 连接状态查询 |
| `src/hooks/useIdeSelection.ts` | IDE 选区/高亮信息 |
| `src/hooks/usePromptsFromClaudeInChrome.tsx` | Chrome 扩展 prompt 注入 |
| `src/hooks/useChromeExtensionNotification.tsx` | Chrome 扩展通知 |
| `src/hooks/useDiffInIDE.ts` | IDE diff 查看 |

**迁移工作**:
- 这些 hooks 与 React/Ink UI 深度耦合，建议保留在 `src/hooks/` 中
- 仅更新对 `packages/ide/` 中迁移模块的 import 路径

**风险**: 低风险

---

### 2.9 Code Indexing (`src/utils/codeIndexing.ts` + `src/native-ts/file-index/`)

**当前状态**: 已实现（`codeIndexing.ts` 仅检测工具使用；`file-index/` 是完整的模糊搜索索引）

**文件**:
- `src/utils/codeIndexing.ts`（~207 行）：检测代码索引工具使用情况（Sourcegraph、Cody 等），用于分析追踪
- `src/native-ts/file-index/index.ts`（~411 行）：高性能模糊文件搜索索引（nucleo 风格评分）

**功能**:
- `codeIndexing.ts`：CLI 命令和 MCP 工具名称的模式匹配，纯分析用途
- `file-index/`：`FileIndex` 类，支持同步/异步构建、模糊搜索、top-k 排序

**迁移工作**:
- `codeIndexing.ts` 是纯分析工具，可选择性迁移
- `file-index/` 是独立的基础设施，可迁移至 `packages/ide/src/indexing/`

**风险**: 低风险，两个模块都是独立的

---

### 2.10 IDE 相关 UI 组件

**当前状态**: 已实现

**文件**:
- `src/components/IdeOnboardingDialog.tsx` — IDE 初次连接引导
- `src/components/IdeAutoConnectDialog.tsx` — 自动连接确认
- `src/components/IdeStatusIndicator.tsx` — 状态指示器
- `src/components/ClaudeInChromeOnboarding.tsx` — Chrome 扩展引导

**迁移工作**: 保留在 `src/components/` 中（UI 组件与 Ink 框架深度耦合）

---

### 2.11 `packages/@ant/claude-for-chrome-mcp/`

**当前状态**: 已实现（完整，独立包）

**文件**: `index.ts`、`mcpServer.ts`、`browserTools.ts`、`toolCalls.ts`、`mcpSocketClient.ts`、`mcpSocketPool.ts`、`bridgeClient.ts`、`types.ts`

**功能**: Chrome 浏览器控制 MCP 服务器，提供标签页管理、导航、截图、GIF 录制、控制台日志等工具

**迁移工作**: 保持为独立的 `packages/@ant/` 包，不需要迁移到 `packages/ide/`

---

### 2.12 IDE 路径转换 (`src/utils/idePathConversion.ts`)

**当前状态**: 已实现

**功能**: WSL/Windows 路径双向转换

**迁移工作**: 与 `src/utils/ide.ts` 一起迁移至 `packages/ide/src/wsl.ts`

---

## 三、`packages/ide/` 目标结构

```
packages/ide/
  package.json
  tsconfig.json
  src/
    index.ts                          # 统一导出
    types.ts                          # IdeType、DetectedIDEInfo 等共享类型
    detection.ts                      # IDE 进程检测（从 ide.ts 拆出）
    connection.ts                     # 连接管理（lockfile、端口、超时）
    installation.ts                   # 扩展安装（VSCode、Artifactory）
    wsl.ts                            # WSL 路径转换 + 跨平台检测
    jetbrains.ts                      # JetBrains 插件检测
    chrome/
      common.ts                       # 浏览器配置、socket、Native Messaging
      setup.ts                        # MCP 服务器配置、manifest 安装
      mcpServer.ts                    # MCP 服务器运行
      prompt.ts                       # 系统提示词
      chromeNativeHost.ts             # Native Host 实现
      setupPortable.ts                # 可移植扩展检测
    services/
      lsp/
        LSPClient.ts
        LSPServerInstance.ts
        LSPServerManager.ts
        LSPDiagnosticRegistry.ts
        manager.ts
        config.ts
        types.ts                      # 需要补充真实类型
        passiveFeedback.ts
    indexing/
      fileIndex.ts                    # 从 native-ts/file-index 迁移
```

---

## 四、任务优先级排序

### P0 — 必须完成（核心架构）

| 序号 | 任务 | 工作量 | 说明 |
|------|------|--------|------|
| 1 | 创建 `packages/ide/` 包骨架 | 0.5d | `package.json`、`tsconfig.json`、Bun workspace 配置 |
| 2 | 提取共享类型 `types.ts` | 0.5d | `IdeType`、`DetectedIDEInfo`、`IDEExtensionInstallationStatus` 等 |
| 3 | 迁移 `ide.ts` → 拆分为 detection/connection/installation/wsl | 2d | 最大的模块，需要仔细拆分避免循环依赖 |
| 4 | 迁移 `jetbrains.ts` | 0.5d | 简单模块 |
| 5 | 更新所有 import 路径 | 1d | ~30+ 处引用需要更新 |

### P1 — 重要功能模块

| 序号 | 任务 | 工作量 | 说明 |
|------|------|--------|------|
| 6 | 迁移 `services/lsp/` 全部 8 个文件 | 1d | LSP 服务层整体迁移 |
| 7 | 补充 `lsp/types.ts` 真实类型 | 0.5d | 当前是 `any` 存根 |
| 8 | 更新 LSPTool import 路径 | 0.5d | `src/tools/LSPTool/` 中的引用 |
| 9 | 迁移 `claudeInChrome/` 7 个文件 | 1d | Chrome 浏览器集成 |
| 10 | 更新 CLI 入口路径 | 0.5d | `cli.tsx` 中的 `--claude-in-chrome-mcp`/`--chrome-native-host` |

### P2 — 可选优化

| 序号 | 任务 | 工作量 | 说明 |
|------|------|--------|------|
| 11 | 迁移 `codeIndexing.ts` | 0.5d | 纯分析工具，优先级低 |
| 12 | 迁移 `file-index/` | 0.5d | 基础设施，可独立于 IDE 包 |
| 13 | 统一导出 `index.ts` | 0.5d | 整理公共 API |
| 14 | 编写迁移后的单元测试 | 1d | 确保迁移未破坏功能 |

---

## 五、风险与难点

### 5.1 高风险

1. **循环依赖**: `src/utils/ide.ts` 内部逻辑耦合紧密（detection → connection → installation 链），拆分子模块时极易产生循环引用。建议先梳理依赖 DAG，按拓扑排序拆分。

2. **WSL 跨平台复杂性**: `idePathConversion.ts` + `detectHostIP()` + `checkWSLDistroMatch()` 涉及 Windows/WSL 双向路径转换和网络配置，迁移后需要完整测试 WSL 环境。

3. **插件系统依赖**: `services/lsp/config.ts` 依赖 `src/utils/plugins/`（插件加载器），迁移后包之间存在反向依赖，需要定义清晰的接口。

### 5.2 中等风险

4. **React/Ink UI 依赖**: `commands/ide/ide.tsx` 和 `commands/chrome/chrome.tsx` 依赖 Ink 组件，迁移至 `packages/` 后需要确保 monorepo 中 React/Ink 的解析路径正确。

5. **Lazy require 模式**: `ide.ts` 中使用 `require('src/components/IdeOnboardingDialog.js')` 的 lazy import，在 monorepo workspace 中可能需要改用动态 `import()`。

6. **Build 产物影响**: 当前 `build.ts` 进行 code splitting，新增 `packages/ide/` 包会影响 chunk 划分，可能需要调整构建配置。

### 5.3 低风险

7. **Native Host wrapper 脚本**: `setup.ts` 中 `createWrapperScript()` 生成的脚本路径基于 `process.execPath`，迁移包后不影响。

8. **Lockfile 路径**: `~/.claude/ide/*.lock` 是运行时生成的，迁移代码不影响。

---

## 六、测试策略

1. **迁移前**: 运行现有测试确保基线通过（`bun test`）
2. **逐模块迁移**: 每迁移一个模块，运行相关测试
3. **重点测试场景**:
   - IDE 检测（macOS/Linux 进程扫描）
   - WSL 环境路径转换
   - LSP 服务器启动/停止/请求
   - Chrome Native Host 消息协议
   - MCP 连接建立（`sse-ide`/`ws-ide`）
4. **手动验证**: 在 VSCode/Cursor 终端中运行 `bun run dev`，验证 `/ide` 命令和自动连接

---

## 七、不在范围内

以下内容不在本次迁移范围内：
- `packages/@ant/claude-for-chrome-mcp/` — 保持为独立的 `@ant` 包
- `src/tools/LSPTool/` — 保留在 Tool 系统中
- `src/hooks/` 中的 IDE 相关 hooks — 保留在 hooks 目录
- `src/components/` 中的 IDE UI 组件 — 保留在 components 目录
- `src/commands/ide/` 和 `src/commands/chrome/` — 可选迁移，建议先保留原位
