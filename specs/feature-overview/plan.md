# V6 架构重构实施计划

> 基于 `design.md` 设计文档与代码库实际状态调查

## 当前代码库概况

### 已有 packages（保留不动）
| Package | 说明 |
|---------|------|
| `packages/@ant/computer-use-mcp/` | Computer Use MCP server |
| `packages/@ant/computer-use-input/` | 键鼠模拟 |
| `packages/@ant/computer-use-swift/` | 截图 + 应用管理 |
| `packages/@ant/claude-for-chrome-mcp/` | Chrome 浏览器控制 |
| `packages/audio-capture-napi/` | 音频捕获 |
| `packages/color-diff-napi/` | 颜色差异 |
| `packages/image-processor-napi/` | 图像处理 |
| `packages/modifiers-napi/` | 修饰键检测（stub） |
| `packages/url-handler-napi/` | URL handler（stub） |

### 设计文档中计划的 14 个新 packages
**全部未创建**。所有代码仍位于 `src/` 目录下，尚无任何 package 开始提取。

---

## Phase 0: 内部分解（低风险，可并行）

### 0.1 main.tsx 分解

**当前状态**: 6609 行（设计文档记录 4680 行，实际更大），包含 ~51 个 subcommand

**关键文件**: `src/main.tsx`

**需要做的具体工作**:
1. 提取 `parseActionOptions`（约 L1003-L3870 内联代码，~2867 行）到独立模块 `src/main/actionHandler.ts`
2. 提取 MCP setup 逻辑到 `src/main/mcpSetup.ts`
3. 提取 headless setup 逻辑到 `src/main/headlessSetup.ts`
4. 提取 session resume 逻辑到 `src/main/sessionResume.ts`
5. 将 51 个 subcommand 注册拆分到 `src/commands/` 下已有的 108 个命令目录中（当前命令目录已存在但注册逻辑仍在 main.tsx 中）
6. main.tsx 仅保留入口和路由分发

**依赖关系**: 无外部依赖，纯内部重构

**风险**: 低。主要是代码搬运，但 subcommand 之间存在隐式共享状态（如 commander program 实例、全局配置），需要仔细梳理

### 0.2 REPL.tsx 分解

**当前状态**: 7049 行（设计文档记录 5005 行，实际更大），54 useState, 68 useEffect, ~30 自定义 Hook

**关键文件**: `src/screens/REPL.tsx`

**需要做的具体工作**:
1. 提取 `useQueryLifecycle` hook（约 830 行）到 `src/screens/REPL/useQueryLifecycle.ts`
2. 提取 `usePromptSubmit` hook（约 350 行）到 `src/screens/REPL/usePromptSubmit.ts`
3. 提取 `useDialogManager` hook（20 路通知优先级）到 `src/screens/REPL/useDialogManager.ts`
4. 提取 `useScrollManager` hook（视口状态机）到 `src/screens/REPL/useScrollManager.ts`
5. 提取 `useSessionInit` hook（初始化和首条消息）到 `src/screens/REPL/useSessionInit.ts`
6. REPL.tsx 仅保留 JSX 组装和少量胶水逻辑

**依赖关系**: hooks 之间存在相互引用（如 useQueryLifecycle 依赖 useDialogManager 的权限回调），需要按依赖拓扑排序

**风险**: 中。React hooks 之间存在闭包陷阱，拆分时需保证 state 引用链不断裂。建议每拆一个 hook 就做完整功能验证

### 0.3 query.ts 分解

**当前状态**: 1732 行

**关键文件**: `src/query.ts`

**需要做的具体工作**:
1. 提取 compaction pipeline（snip/micro/auto）到 `src/query/compactionPipeline.ts`
2. 提取 streaming orchestrator（流+错误+abort 处理）到 `src/query/streamingOrchestrator.ts`
3. 提取 recovery 逻辑（max_tokens/ptl 恢复）到 `src/query/recovery.ts`
4. 提取 attachments 处理（files/mem/skill）到 `src/query/attachments.ts`

**依赖关系**: 各子模块相互独立，仅被 query() 主函数调用

**风险**: 低。query.ts 结构相对清晰，每个逻辑块边界明确

### 0.4 services/mcp/client.ts 分解

**当前状态**: 3351 行

**关键文件**: `src/services/mcp/client.ts`

**需要做的具体工作**:
1. 提取 transport manager（stdio/SSE/WS）到 `src/services/mcp/transportManager.ts`
2. 提取 tool discovery（MCPTool 实例化）到 `src/services/mcp/toolDiscovery.ts`
3. 提取 auth manager（OAuth+重连）到 `src/services/mcp/authManager.ts`（注意 `src/services/mcp/auth.ts` 已存在，需合并或分层）

**依赖关系**: MCPConnectionManager.tsx 已存在，需与 client.ts 拆分后的模块协调

**风险**: 低-中。MCP client 有复杂的连接状态管理，transport 层和 tool discovery 层有隐式耦合

### 0.5 LocalMainSessionTask.ts 分解

**当前状态**: 481 行（设计文档记录 15373 行，**严重不符**）

**关键文件**: `src/tasks/LocalMainSessionTask.ts`

**实际情况**: 文件仅 481 行，并非全库最大单体文件。设计文档中的 15373 行数据可能有误，或已被部分分解。

**需要做的具体工作**:
1. **重新评估**：481 行的文件不需要紧急分解
2. 检查 `src/tasks/` 目录下其他任务文件（共 9 个 task 文件），确认是否存在其他大型文件
3. 如果当前结构合理，可降低此任务优先级

**风险**: 低。当前文件规模可控

### 0.6 AppState Domain Slicing

**当前状态**: 200 行类型定义（设计文档记录 199 行，基本吻合）

**关键文件**: `src/state/AppState.tsx`

**需要做的具体工作**:
1. 将单一嵌套类型拆分为 domain slices：
   - `UISlice`（verbose, expanded, footer, spinner）
   - `MCPSlice`（clients, tools, commands, resources）
   - `PermissionSlice`（toolPermissionContext）
   - `BridgeSlice`（replBridge* ~20 字段）
   - `AgentSlice`（tasks, agents, team）
   - `PluginSlice`（enabled, commands）
2. 组合类型：`type AppState = UISlice & MCPSlice & PermissionSlice & BridgeSlice & AgentSlice & PluginSlice`

**依赖关系**: 被所有 UI 组件和核心模块引用，属于全局类型变更

**风险**: 低-中。类型变更影响面广但 TypeScript 编译器会捕获所有破坏点

---

## Phase 1: packages/ink/（风险：低）

**当前状态**: 未创建。Ink 框架代码位于 `src/ink/`（51 个文件）

### 1.1 Ink 框架核心迁移

**源文件**: `src/ink/`（51 文件）包含 reconciler、hooks、components、layout 等

**需要做的具体工作**:
1. 创建 `packages/ink/` 包结构（package.json、tsconfig.json、index.ts）
2. 迁移 `src/ink/` 下所有文件到 `packages/ink/src/`
3. 处理内部依赖（ink 内部模块间引用改为包内相对路径）
4. 导出公共 API：`render`、`useInput`、`useTerminalSize`、`useSearchHighlight` 等

**依赖关系**: 被 `src/ink.ts`（Ink render wrapper）和所有 UI 组件依赖

**风险**: 低。Ink 框架边界清晰，但需注意 ThemeProvider 注入逻辑

### 1.2 Keybinding 系统迁移

**当前状态**: 已完整实现在 `src/keybindings/`（16 文件，约 3223 行）

**源文件**: `src/keybindings/` 目录（schema.ts、match.ts、resolver.ts、parser.ts 等）

**需要做的具体工作**:
1. 迁移到 `packages/ink/src/keybindings/`
2. 处理对 React context 的依赖（KeybindingContext.tsx、KeybindingProviderSetup.tsx）
3. 确保与 Ink 框架的 useInput hook 集成

**风险**: 低。keybinding 模块已有清晰的接口边界

### 1.3 Vim 模拟迁移

**当前状态**: 已实现在 `src/vim/`（5 文件，约 1513 行）

**源文件**: `src/vim/`（motions.ts、operators.ts、transitions.ts、types.ts、textObjects.ts）

**需要做的具体工作**:
1. 迁移到 `packages/ink/src/vim/`
2. 确保与 keybinding 系统集成

**风险**: 低。独立模块，无外部依赖

### 1.4 Typeahead/Suggestion 系统

**当前状态**: 部分实现在 `src/utils/suggestions/`（commandSuggestions.ts、directoryCompletion.ts、shellHistoryCompletion.ts、skillUsageTracking.ts、slackChannelSuggestions.ts）

**需要做的具体工作**:
1. 迁移到 `packages/ink/src/suggestions/`
2. 统一模糊搜索接口
3. 添加 ghost text 渲染支持（如果有相关组件的话）

**风险**: 低-中。suggestion 模块可能与业务逻辑（如 skillUsageTracking）有耦合

---

## Phase 2: 独立系统提取（风险：低-中）

### 2.1 packages/agent-tools/ — Agent 工具库

**当前状态**: 未创建。工具代码分散在 `src/tools/`（56 个工具目录）和 `src/tools.ts`（387 行注册文件）

**源文件**:
- `src/tools.ts` — 工具注册列表
- `src/tools/<ToolName>/` — 56 个工具目录（AgentTool, BashTool, FileEditTool, GrepTool 等）
- `src/Tool.ts` — Tool 接口定义
- `src/tools/shared/` — 工具共享工具函数

**需要做的具体工作**:
1. 创建 `packages/agent-tools/` 包结构
2. 迁移 `src/Tool.ts` 类型定义
3. 迁移 56 个工具实现（每个工具包含 name、description、inputSchema、call() 及 React 渲染组件）
4. 提取 Sandbox 系统到 `packages/agent-tools/src/sandbox/`（来自 `src/utils/sandbox/`）
5. 导出工具注册函数（替代 `getAllBaseTools` 静态列表）
6. 定义 `ModelDeps` 注入点

**依赖关系**: 部分工具依赖 UI 组件（React 渲染），需要解耦或保留 UI 渲染在原处。工具间存在依赖（如 AgentTool 依赖其他工具）

**风险**: 中。56 个工具规模庞大，部分工具包含 React 组件需要仔细处理 UI 依赖边界

### 2.2 packages/memory/ — 记忆系统

**当前状态**: 未创建。记忆相关代码分散在多处

**源文件**:
- `src/memdir/`（8 文件，约 1743 行）— 核心记忆逻辑
- `src/utils/memory/` — 记忆工具函数
- `src/utils/memoryFileDetection.ts` — 记忆文件检测
- `src/commands/memory/` — 记忆命令
- `src/components/memory/` — 记忆 UI 组件
- `src/services/SessionMemory/` — 会话记忆服务
- `src/services/extractMemories/` — 记忆提取服务
- `src/services/teamMemorySync/` — 团队记忆同步

**需要做的具体工作**:
1. 创建 `packages/memory/` 包结构
2. 迁移核心存储抽象：`MemoryStore`、`MemoryRecall`、`MemoryExtract`、`MemoryConsolidation`
3. 迁移记忆类型定义（user/feedback/project/reference）
4. 分离纯逻辑与 UI 组件（UI 组件保留在 `src/components/memory/`）

**依赖关系**: 被记忆命令、REPL、query 循环引用

**风险**: 低-中。记忆系统相对独立，但 `services/teamMemorySync` 和 `services/SessionMemory` 可能与外部服务有耦合

### 2.3 packages/permission/ — 权限系统

**当前状态**: 未创建。权限相关代码约 9416 行

**源文件**:
- `src/utils/permissions/`（约 9416 行总计）— 核心权限逻辑（27 个文件）
  - `PermissionMode.ts`、`PermissionResult.ts`、`PermissionRule.ts`
  - `permissions.ts`、`permissionsLoader.ts`
  - `yoloClassifier.ts` — AI 自动分类
  - `bashClassifier.ts`、`dangerousPatterns.ts`
  - `shellRuleMatching.ts`、`pathValidation.ts`
  - `autoModeState.ts` — 自动模式状态
- `src/types/permissions.ts` — 权限类型定义

**需要做的具体工作**:
1. 创建 `packages/permission/` 包结构
2. 迁移 8 种权限模式定义
3. 迁移权限检查管线（allow/deny/ask 规则）
4. 迁移 AI 自动分类器
5. 定义 `ToolPermissionContext` 接口
6. 导出权限检查公共 API

**依赖关系**: 被 BashTool、所有工具权限检查、REPL 权限 UI 依赖

**风险**: 中。权限系统是安全核心，AI 分类器依赖 LLM 调用，需要确保提取后权限检查行为不变

### 2.4 packages/config/ — 配置管理

**当前状态**: 未创建。配置相关代码约 1821 行+

**源文件**:
- `src/utils/config.ts`（1821 行）— 全局配置（apiKey/oauthToken 等）
- `src/utils/configConstants.ts` — 配置常量
- `src/utils/settings/` — 设置验证、MDM 管理
- `src/services/remoteManagedSettings/`（6 文件）— 企业远程管控
- `src/services/settingsSync/`（2 文件）— 跨设备同步
- `src/query/config.ts` — 查询配置

**需要做的具体工作**:
1. 创建 `packages/config/` 包结构
2. 迁移 SettingsManager（7 层优先级合并）
3. 迁移 FeatureFlagProvider（当前 feature flags 通过 `bun:bundle` 的 `feature()` 函数实现，需要抽象为可注入的 provider 接口）
4. 迁移 SettingsSync
5. 迁移 RemoteManagedSettings
6. 迁移 GlobalConfig（config.ts 1821 行）
7. 处理 feature flag 的 `bun:bundle` 依赖（需要在 package 中提供替代实现）

**依赖关系**: 被几乎所有模块依赖（基础设施层）

**风险**: 低-中。config.ts 是全局基础，影响面极广。feature flag 的 `bun:bundle` 依赖需要特殊处理

### 2.5 packages/telemetry/ — 遥测/诊断

**当前状态**: 未创建。遥测代码约 4062 行（真实实现，非空 stub）

**源文件**:
- `src/services/analytics/`（约 4062 行）— 核心遥测
  - `growthbook.ts` — AB 测试/Feature Flag
  - `datadog.ts` — 日志上传
  - `firstPartyEventLogger.ts` — 第一方事件日志
  - `firstPartyEventLoggingExporter.ts` — OTel 日志导出
  - `metadata.ts` — 事件元数据 enrichment
  - `config.ts` — 遥测配置
  - `sink.ts` / `sinkKillswitch.ts` — 事件汇聚
- `src/utils/sentry.ts` — Sentry 集成

**需要做的具体工作**:
1. 创建 `packages/telemetry/` 包结构
2. 迁移 AnalyticsEventEmitter（OTel 日志导出 + JSONL 批处理）
3. 迁移 GrowthBook 客户端
4. 迁移 Datadog 日志上传
5. 迁移 SessionTracer
6. 迁移 Metadata enrichment
7. 确保所有遥测点都通过统一接口调用

**依赖关系**: 被 query 循环、工具调用、权限检查等广泛引用。CLAUDE.md 说明 Analytics/GrowthBook/Sentry 为空实现，但代码中实际有真实逻辑

**风险**: 中。需要谨慎处理——确保提取后不会意外启用被禁用的遥测，同时保持 stub 接口不变

---

## Phase 3: packages/agent/（风险：中-高）

**当前状态**: 未创建。核心引擎代码约 8229 行+

**包独立性原则**:
- `packages/agent` 是独立包，零外部运行时依赖（不 import src/, React, Ink, bun:bundle）
- 所有外部能力通过 `AgentDeps` 依赖注入接口传入
- 唯一输出通道为 `AsyncGenerator<AgentEvent>` 统一事件流
- 适配器层 (`src/agent/`) 桥接现有实现到 `AgentDeps` 接口
- 详细设计见 `specs/feature-agent-core/design.md`

### 3.1 query() + QueryEngine 核心循环

**源文件**:
- `src/query.ts`（1732 行）— 主 API 查询函数
- `src/QueryEngine.ts`（1320 行）— 高层编排器
- Phase 0 分解后的子模块

**需要做的具体工作**:
1. 创建 `packages/agent/` 包结构（独立包，`@anthropic/agent`）
2. 定义 `AgentDeps` 8 个子接口（provider, tools, permission, output, hooks, compaction, context, session）
3. 定义 `AgentEvent` 统一事件流类型（message, tool_start/progress/result, permission_request, compaction, done）
4. 迁移 query() 核心循环到 `packages/agent/core/AgentLoop.ts`
5. 创建 `AgentCore` 公共 API 类（run/interrupt/getMessages/getState/setModel）
6. 在 `src/agent/` 创建适配器实现，桥接现有代码到 AgentDeps 接口
7. 重构 QueryEngine 为会话编排层（内部组合 AgentCore）

**依赖关系**: AgentDeps 接口由 src/agent/ 适配器桥接（provider→services/api, tools→ToolRegistry, permission→permissions pipeline, 等）

**风险**: 中-高。这是核心循环，任何变更都可能影响对话质量

### 3.2 Hook 生命周期系统

**当前状态**: `src/utils/hooks.ts`（5177 行）+ `src/hooks/`（83 文件）

**需要做的具体工作**:
1. 提取 27 种 hook 事件类型定义到 `packages/agent/src/hooks/types.ts`
2. 实现 HookLifecycle 管理器（PreToolUse、PostToolUse、Notification、Stop 等）
3. 迁移 hooks.ts 中的 hook 注册和分发逻辑
4. 确保所有 hook 调用点通过统一接口

**依赖关系**: 被 query 循环、工具调用、REPL 等广泛引用

**风险**: 中。27 种事件类型的接口设计需要一次性到位，后续修改成本高

### 3.3 Compaction 服务

**当前状态**: `src/services/compact/`（18 文件，约 4049 行）

**需要做的具体工作**:
1. 迁移到 `packages/agent/src/compaction/`
2. 统一三种 compaction 策略：snip、micro、auto
3. 提取配置管理（cachedMCConfig、timeBasedMCConfig）
4. 迁移 post-compact 清理逻辑

**依赖关系**: 被 QueryEngine 调用

**风险**: 低。compaction 服务相对独立

### 3.4 Cron/Scheduler

**当前状态**: `src/utils/cron*.ts`（6 文件）

**需要做的具体工作**:
1. 迁移 `cron.ts`、`cronTasks.ts`、`cronTasksLock.ts`、`cronJitterConfig.ts`、`cronScheduler.ts`
2. 定义 CronScheduler 接口

**风险**: 低

### 3.5 FileHistory

**当前状态**: `src/utils/fileHistory.ts`（另有多处副本，疑似 decompilation 产物）

**需要做的具体工作**:
1. 合并去重 fileHistory.ts 的多个副本
2. 迁移到 `packages/agent/src/fileHistory.ts`

**风险**: 低

---

## Phase 4: packages/provider/ + packages/shell/（风险：中）

### 4.1 packages/provider/ — LLM Provider 适配器

**当前状态**: 未创建。API 层代码约 4297 行+

**源文件**:
- `src/services/api/claude.ts`（3415 行）— 核心 API 客户端
- `src/services/api/openai/`（6 文件，882 行）— OpenAI 兼容层（已有参考实现）
- `src/utils/model/providers.ts`（48 行）— Provider 选择逻辑

**需要做的具体工作**:
1. 创建 `packages/provider/` 包结构
2. 定义 `ProviderAdapter` 接口：
   - `queryStream()` — 流式查询
   - `query()` — 同步查询
   - `isAvailable()` — 可用性检查
   - `listModels()` — 模型列表
3. 实现 Anthropic Provider（从 claude.ts 提取）
4. 实现 OpenAI Provider（从 openai/ 提取，已有 882 行参考实现）
5. 实现 Bedrock Provider（从 claude.ts 的 if 分支提取）
6. 实现 Vertex Provider（从 claude.ts 的 if 分支提取）
7. 定义 `StreamAdapter`（归一化 SSE/WS/流 到统一内部事件格式）
8. 定义 `ContextProvider`（可插拔 prompt 管线：GitStatus -> ClaudeMd -> Date -> Attribution）
9. 定义 `NetworkLayer`（proxy/mTLS/CA 证书/upstream proxy）

**依赖关系**: 被 packages/agent 的 query() 调用

**风险**: 中。Provider 分发目前靠 if/else 字符串比较（108 处 provider 相关引用），提取需要统一为策略模式

### 4.2 Auth Provider 适配器

**当前状态**: 分散在多处，总计约 3857 行

**源文件**:
- `src/auth.ts`（211 行）— 主认证入口
- `src/services/oauth/`（6 文件，1063 行）— OAuth 实现
- 其他认证逻辑分散在 provider 分支中

**需要做的具体工作**:
1. 定义 `AuthProvider` 接口：
   - `getCredentials()` — 获取凭证
   - `refresh()` — 刷新令牌
   - `invalidate()` — 使失效
2. 实现 AnthropicOAuth
3. 实现 APIKey（Keychain/env/config）
4. 实现 AWS（Bedrock IAM）
5. 实现 GCP（Vertex ADC）
6. 实现 Azure（Managed Identity）

**风险**: 高。7 种认证方式涉及安全凭证管理，提取后需确保不泄漏密钥

### 4.3 packages/shell/ — Shell 执行层

**当前状态**: 未创建。Shell 相关代码约 3069 行+

**源文件**:
- `src/utils/shell/`（约 3069 行）— Shell 抽象
  - `shellProvider.ts` — ShellProvider 接口
  - `bashProvider.ts` — Bash/Zsh 实现
  - `powershellProvider.ts` — PowerShell 实现
  - `specPrefix.ts`、`prefix.ts` — 命令前缀注入
  - `outputLimits.ts` — 输出限制
  - `resolveDefaultShell.ts` — 默认 Shell 检测
- `src/tools/PowerShellTool/` — PowerShell 工具（Windows 路径转换）

**需要做的具体工作**:
1. 创建 `packages/shell/` 包结构
2. 迁移 ShellProvider 接口（统一 bash/zsh/PowerShell）
3. 迁移 Bash/Zsh 实现（命令前缀注入/超时/环境构建）
4. 迁移 PowerShell 实现（Windows 路径转换/FindGitBash）
5. 迁移子进程环境构建（subprocessEnv）

**依赖关系**: 被 BashTool、PowerShellTool 调用

**风险**: 中。Shell 执行是安全敏感区域，需要确保沙盒逻辑正确迁移

---

## Phase 5: 扩展系统（风险：中-高）

### 5.1 packages/swarm/ — 多 Agent 协调

**当前状态**: 未创建。Swarm 相关代码约 4107 行

**源文件**:
- `src/utils/swarm/`（约 4107 行）— 14 文件
  - `inProcessRunner.ts`、`spawnInProcess.ts` — 进程管理
  - `backends/` — 后端实现
  - `permissionSync.ts` — 权限同步
  - `teamHelpers.ts`、`teammateInit.ts` — 团队协作
  - `teammateLayoutManager.ts` — 布局管理
  - `It2SetupPrompt.tsx` — iTerm2 集成

**需要做的具体工作**:
1. 创建 `packages/swarm/` 包结构
2. 迁移多 Agent 协调核心
3. 迁移 Backends（进程/Tmux/iTerm2）
4. 迁移 PermissionSync
5. 迁移 TeammateMailbox
6. 迁移 Worktree 管理

**依赖关系**: 依赖 packages/agent（Agent 生命周期）、packages/permission（权限同步）

**风险**: 高。多 Agent 协调涉及进程管理和权限同步，复杂度高

### 5.2 packages/ide/ — IDE/LSP 集成

**当前状态**: 未创建。LSP 相关代码已存在

**源文件**:
- `src/services/lsp/`（7 文件）— LSP 客户端/服务器管理
  - `LSPClient.ts`、`LSPServerManager.ts`、`LSPServerInstance.ts`
  - `LSPDiagnosticRegistry.ts`
  - `manager.ts`、`config.ts`、`types.ts`
- `src/utils/plugins/lspPluginIntegration.ts` — LSP 插件集成
- `src/utils/idePathConversion.ts` — IDE 路径转换

**需要做的具体工作**:
1. 创建 `packages/ide/` 包结构
2. 迁移 VS Code 集成
3. 迁移 JetBrains 集成
4. 迁移 LSP Client/Server
5. 迁移 Code Indexing
6. 迁移 Claude-in-Chrome（来自 `packages/@ant/claude-for-chrome-mcp/`）

**风险**: 中。IDE 集成涉及跨进程通信

### 5.3 packages/server/ — 服务器模式

**当前状态**: 未创建。服务器代码约 389 行（有效代码）

**源文件**:
- `src/server/`（12 文件）— 但大部分为 stub
  - `server.ts`、`sessionManager.ts`、`directConnectManager.ts`
  - `lockfile.ts`、`parseConnectUrl.ts`

**需要做的具体工作**:
1. 创建 `packages/server/` 包结构
2. 迁移 DirectConnect 实现
3. 迁移 LockFile 管理
4. 补全 stub 文件的功能实现

**风险**: 低。大部分为 stub，功能有限

### 5.4 packages/teleport/ — 远程执行环境

**当前状态**: 未创建。约 2190 行

**源文件**:
- `src/utils/teleport.tsx`（1518 行）
- `src/utils/teleport/`（5 文件：api.ts、environmentSelection.ts、environments.ts、gitBundle.ts）
- `src/commands/teleport/` — teleport 命令

**需要做的具体工作**:
1. 创建 `packages/teleport/` 包结构
2. 迁移环境选择和配置
3. 迁移 Git 打包逻辑
4. 迁移 API 集成

**风险**: 中。涉及远程环境管理

### 5.5 packages/updater/ — 自动更新

**当前状态**: 未创建

**源文件**:
- `src/cli/update.ts` — 更新逻辑
- `src/utils/plugins/pluginAutoupdate.ts` — 插件自动更新

**需要做的具体工作**:
1. 创建 `packages/updater/` 包结构
2. 实现 NativeInstaller（.deb/.rpm/.pkg）
3. 实现 BinaryDownload
4. 实现 AutoUpdateCheck

**风险**: 低。更新逻辑相对独立

### 5.6 packages/cli/ — CLI 传输层

**当前状态**: 部分实现。`src/cli/` 目录已有 12 文件，约 7212 行

**源文件**:
- `src/cli/transports/`（约 3244 行）— HybridTransport、SSETransport、WebSocketTransport、Transport
- `src/cli/handlers/`（约 1464 行）— agents、ant、auth、autoMode、mcp、plugins 等处理器
- `src/cli/structuredIO.ts` — 结构化 IO
- `src/cli/rollback.ts` — 回滚
- `src/cli/bg.ts`、`src/cli/up.ts` — 后台/前台管理

**需要做的具体工作**:
1. 创建 `packages/cli/` 包结构
2. 迁移 Transport 抽象和实现（Hybrid/SSE/WS/Worker）
3. 迁移 StructuredIO
4. 迁移 Rollback 逻辑
5. 迁移 Handler 分发

**风险**: 低-中。CLI 传输层相对独立，但 handler 与业务逻辑有耦合

---

## Tool Registry / Output Target（贯穿性工作）

### Tool Registry

**当前状态**: `src/tools.ts`（387 行硬编码列表），56 个工具目录

**需要做的具体工作**:
1. 将 `getAllBaseTools` 静态列表改为动态注册机制
2. 支持内置工具（静态注册）、MCP 工具（动态发现）、Plugin 工具、用户自定义工具
3. 提供工具发现 API

**风险**: 低。注册机制改造向后兼容

### Output Target

**当前状态**: 148 个 UI 组件在 `src/components/`

**需要做的具体工作**:
1. 定义 OutputTarget 接口（Terminal/JSON/Web/Silent）
2. 将工具渲染组件与核心逻辑解耦
3. 允许不同输出模式选择性加载 UI 组件

**风险**: 中-高。148 个组件涉及面太广

---

## 命令系统（贯穿性工作）

**当前状态**: `src/commands/`（108 个目录，~96 个命令）

**需要做的具体工作**:
1. 定义统一的 Command 接口
2. 实现命令发现机制（替代 main.tsx 中的硬编码注册）
3. 支持命令别名和分组

**风险**: 低

---

## Storage Backend

**当前状态**: `src/utils/sessionStorage.ts`（5106 行，JSONL）

**需要做的具体工作**:
1. 定义 StorageBackend 接口
2. 实现 LocalFile（当前 JSONL）
3. 预留 RemoteAPI 和 Memory（测试）接口

**风险**: 低-中。sessionStorage 是会话持久化核心

---

## 实施优先级排序

### P0 — 立即开始（基础设施，无外部依赖）
1. **packages/config/** — 被所有模块依赖，必须先就位
2. **main.tsx 分解** — 降低代码复杂度，为后续提取扫清道路

### P1 — 高价值（Phase 2 核心系统）
3. **packages/agent-tools/** — 56 个工具，生态核心
4. **packages/permission/** — 安全基础设施
5. **packages/memory/** — 跨会话记忆
6. **packages/ink/** — UI 框架独立

### P2 — 高价值但复杂（Phase 3-4）
7. **packages/provider/** + Auth Provider — 多模型支持核心
8. **packages/agent/** — 核心引擎 (独立包, 零外部依赖, AgentDeps DI + AgentEvent 事件流)
9. **packages/shell/** — Shell 执行层
10. **REPL.tsx 分解** — 可维护性
11. **packages/telemetry/** — 可观测性

### P3 — 扩展能力（Phase 5）
12. **packages/swarm/** — 多 Agent 协调
13. **packages/ide/** — IDE 集成
14. **packages/cli/** — CLI 传输层
15. **packages/teleport/** — 远程执行
16. **packages/server/** — 服务器模式
17. **packages/updater/** — 自动更新

### P4 — 优化改善
18. **AppState Domain Slicing**
19. **query.ts 分解**（已相对清晰）
20. **mcp/client.ts 分解**
21. **Output Target**
22. **Feature Flag Provider**

---

## 关键风险和难点

### 1. `bun:bundle` 依赖
`feature()` 函数通过 `import { feature } from 'bun:bundle'` 导入，这是 Bun 运行时内置模块。提取为独立 package 后需要：
- 在 package 内提供 feature flag 的抽象接口
- 运行时通过依赖注入传入实际实现
- 不能简单地去掉 `bun:bundle` 依赖

### 2. React Compiler 产物
组件中包含 decompiled memoization 样板代码（`const $ = _c(N)`）。拆分 hooks 和组件时需要确保：
- React Compiler runtime 引用不断裂
- memoization 边界不被破坏

### 3. 循环依赖
当前 `src/` 下的模块存在大量循环引用（如 query.ts <-> QueryEngine.ts <-> REPL.tsx）。提取为独立 package 时需要：
- 严格定义单向依赖关系
- 通过接口/事件解耦循环引用
- 可能需要引入中介者模式

### 4. 测试覆盖
当前 ~1623 tests / 114 files。大规模重构需要：
- 每个提取步骤前后运行完整测试套件
- 为新 package 的公共 API 补充单元测试
- 集成测试确保端到端行为不变

### 5. Workspace 配置
`package.json` 已配置 `"workspaces": ["packages/*", "packages/@ant/*"]`，新 package 可以直接放入 `packages/` 目录。需要确保：
- 每个 package 有正确的 `package.json`（name、version、exports）
- TypeScript 路径映射正确
- Bun build 能正确处理 workspace 依赖

### 6. 设计文档数据偏差
设计文档中部分数据与实际代码不符：
- LocalMainSessionTask.ts：设计文档 15373 行 vs 实际 481 行
- main.tsx：设计文档 4680 行 vs 实际 6609 行
- REPL.tsx：设计文档 5005 行 vs 实际 7049 行
- 实施前需对每个模块重新评估实际行数和复杂度
