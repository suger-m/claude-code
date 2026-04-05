# 权限系统实现计划

> 基于 `design.md` 设计文档与代码库实际状态调查
> 生成日期: 2026-04-05

## 一、总体评估

权限系统是整个 CLI 工具的核心安全模块，当前代码库中已有大量实现。核心逻辑集中在 `src/utils/permissions/`（24 文件，~9412 行），UI 组件集中在 `src/components/permissions/`（~11532 行），类型定义在 `src/types/permissions.ts`（442 行）。

**整体实现状态：约 90% 已实现**，但存在以下问题：
- 部分模块是 stub 实现（`bashClassifier.ts` 在外部构建中完全 stub）
- YOLO Classifier（`auto` 模式）依赖 `TRANSCRIPT_CLASSIFIER` feature flag
- 测试覆盖集中在解析和规则匹配，核心管线 `hasPermissionsToUseToolInner` 缺少测试
- 文件系统权限检查（`filesystem.ts` 1778 行）逻辑复杂，是安全敏感模块

---

## 二、模块清单与状态

### 2.1 类型定义层

#### `src/types/permissions.ts` — 已实现 (442 行)

- **状态**: 已完成
- **内容**: 纯类型定义，无运行时依赖。定义了 PermissionMode 联合类型、PermissionBehavior、PermissionRule、PermissionUpdate、PermissionDecision、YoloClassifierResult、ToolPermissionContext 等核心类型
- **需要做**: 无需修改，类型定义完整且稳定

#### `src/utils/permissions/PermissionRule.ts` — 已实现 (40 行)

- **状态**: 已完成
- **内容**: Zod schema 定义 + 从 `types/permissions.ts` 的 re-export
- **需要做**: 无

#### `src/utils/permissions/PermissionResult.ts` — 已实现 (35 行)

- **状态**: 已完成
- **内容**: 类型 re-export + `getRuleBehaviorDescription()` 辅助函数
- **需要做**: 无

#### `src/utils/permissions/PermissionUpdateSchema.ts` — 已实现 (78 行)

- **状态**: 已完成
- **内容**: Zod schema 定义所有 PermissionUpdate 变体（addRules / replaceRules / removeRules / setMode / addDirectories / removeDirectories）
- **需要做**: 无

#### `src/utils/permissions/PermissionPromptToolResultSchema.ts` — 已实现 (127 行)

- **状态**: 已完成
- **内容**: Permission Prompt Tool 的输入/输出 Zod schema，用于外部程序化审批
- **需要做**: 无

---

### 2.2 权限模式管理

#### `src/utils/permissions/PermissionMode.ts` — 已实现 (141 行)

- **状态**: 已完成
- **内容**: PermissionMode 枚举定义、Zod schema、模式配置（标题/颜色/符号）、`isExternalPermissionMode()`、`permissionModeFromString()` 等工具函数
- **实现细节**:
  - 5 种外部模式：`default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`
  - 2 种内部模式：`auto`（需 TRANSCRIPT_CLASSIFIER feature flag）、`bubble`（子 agent）
  - `auto` 模式在外部构建中不暴露
- **需要做**: 无

#### `src/utils/permissions/getNextPermissionMode.ts` — 已实现 (101 行)

- **状态**: 已完成
- **内容**: Shift+Tab 模式循环逻辑。`getNextPermissionMode()` 定义循环顺序，`cyclePermissionMode()` 执行切换并准备上下文
- **需要做**: 无

---

### 2.3 规则解析与匹配

#### `src/utils/permissions/permissionRuleParser.ts` — 已实现 (198 行)

- **状态**: 已完成，有测试覆盖（152 行测试）
- **内容**: 规则字符串解析（`"Bash(git push:*)"` → `{ toolName: "Bash", ruleContent: "git push:*" }`）、括号转义处理、旧工具名别名映射
- **测试**: `__tests__/permissionRuleParser.test.ts` 覆盖 escape/unescape/parse/toString
- **需要做**: 无

#### `src/utils/permissions/shellRuleMatching.ts` — 已实现 (228 行)

- **状态**: 已完成，有测试覆盖（145 行测试）
- **内容**: Shell 命令规则匹配（exact / prefix / wildcard 模式）、规则解析、权限建议生成
- **需要做**: 无

#### `src/utils/permissions/shadowedRuleDetection.ts` — 已实现 (234 行)

- **状态**: 已完成，无测试
- **内容**: 检测被遮蔽（unreachable）的权限规则——当 ask/deny 规则被同工具的高优先级规则覆盖时发出警告
- **需要做**: 补充单元测试

---

### 2.4 核心权限检查管线

#### `src/utils/permissions/permissions.ts` — 已实现 (1486 行)

- **状态**: 核心已完成，是整个系统最关键的文件
- **内容**:
  - `hasPermissionsToUseTool()` — 公开入口
  - `hasPermissionsToUseToolInner()` — 核心管线（~160 行），实现了 design.md 中描述的三步检查：
    - Step 1: 强制检查（deny 规则 → ask 规则 → tool.checkPermissions() → 安全检查）
    - Step 2: 模式决策（bypassPermissions → alwaysAllow → passthrough→ask）
    - Step 3: 结果返回
  - 规则查询辅助函数：`getDenyRuleForTool()`、`getAskRuleForTool()`、`toolAlwaysAllowedRule()` 等
  - 规则 CRUD：`deletePermissionRule()`
  - Agent 过滤：`getDenyRuleForAgent()`、`filterDeniedAgents()`
- **测试**: `__tests__/permissions.test.ts`（165 行），仅测试了规则查询函数，**核心管线 `hasPermissionsToUseToolInner` 未被测试**
- **需要做**:
  - [P1] 为 `hasPermissionsToUseToolInner` 补充单元/集成测试
  - [P2] 考虑拆分文件，将规则查询和 CRUD 操作提取到独立模块

#### `src/utils/permissions/permissionSetup.ts` — 已实现 (1533 行)

- **状态**: 已完成
- **内容**: 权限上下文初始化和规则加载的核心入口
  - 从 7 种来源加载规则（userSettings / projectSettings / localSettings / flagSettings / policySettings / cliArg / command）
  - `createToolPermissionContext()` — 构建完整的 ToolPermissionContext
  - `transitionPermissionMode()` — 模式切换时的上下文转换（含 auto 模式的危险规则剥离）
  - `verifyAutoModeGateAccess()` — Auto 模式门控检查
  - `shouldDisableBypassPermissions()` — Bypass 模式远程开关
- **需要做**:
  - [P1] 补充测试（当前无测试文件）
  - [P2] 考虑拆分为多个子模块（上下文构建 / 模式转换 / 门控检查）

---

### 2.5 文件系统权限

#### `src/utils/permissions/filesystem.ts` — 已实现 (1778 行)

- **状态**: 已完成，是第二大文件
- **内容**:
  - 路径安全检查：UNC/Windows/拒绝/工作目录/内部路径验证
  - 危险文件/目录保护（`.git`、`.claude`、`.bashrc` 等）
  - 文件读写权限规则匹配
  - `checkPathSafetyForAutoEdit()` — auto 模式下的路径安全检查
  - `pathInWorkingPath()` / `pathInAllowedWorkingPath()` — 工作目录校验
- **需要做**:
  - [P1] 补充路径安全相关的测试
  - [P2] 考虑拆分为 `filesystemPathCheck.ts` 和 `filesystemRuleMatch.ts`

#### `src/utils/permissions/pathValidation.ts` — 已实现 (486 行)

- **状态**: 已完成
- **内容**: 高层路径验证逻辑，封装 filesystem.ts 中的底层检查，提供 `checkPath()`、`validateFilePath()` 等 API
- **需要做**: 补充测试

---

### 2.6 Bash 权限

#### `src/utils/permissions/bashClassifier.ts` — Stub 实现 (61 行)

- **状态**: 外部构建中为 stub，内部构建通过 feature flag 启用
- **内容**: 外部 stub 版本——所有分类函数返回空/false，`classifyBashCommand()` 返回 `matches: false`
- **实际实现位置**: Bash 分类逻辑在 `src/tools/BashTool/bashPermissions.ts` 和 `src/tools/BashTool/bashClassifier.ts` 中
- **需要做**: 无（这是预期的 feature flag 行为）

#### `src/utils/permissions/dangerousPatterns.ts` — 已实现 (80 行)

- **状态**: 已完成，有测试覆盖（93 行测试）
- **内容**: 跨平台代码执行入口点列表（python、node、deno 等），用于在 auto 模式中剥离危险权限规则
- **需要做**: 无

---

### 2.7 YOLO Classifier（Auto 模式）

#### `src/utils/permissions/yoloClassifier.ts` — 已实现 (1495 行)

- **状态**: 已完成，依赖 `TRANSCRIPT_CLASSIFIER` feature flag
- **内容**: 两阶段 AI 分类器
  - Stage 1: 快速分类（无 thinking），使用轻量模型
  - Stage 2: 深度分析（chain-of-thought），当 Stage 1 不确定时触发
  - 支持 transcript 截断处理和错误回退
- **需要做**:
  - [P2] 补充 mock 测试（需要 mock `sideQuery` API 调用）

#### `src/utils/permissions/classifierDecision.ts` — 已实现 (98 行)

- **状态**: 已完成
- **内容**: Auto 模式允许列表工具判断，定义了哪些工具在 auto 模式下不需要 classifier 检查
- **需要做**: 补充测试

#### `src/utils/permissions/classifierShared.ts` — 已实现 (39 行)

- **状态**: 已完成
- **内容**: 共享的 classifier 工具函数（tool_use block 提取、响应解析）
- **需要做**: 无

#### `src/utils/permissions/autoModeState.ts` — 已实现 (39 行)

- **状态**: 已完成
- **内容**: Auto 模式运行时状态（活跃标志、CLI 参数标志、熔断器状态）
- **需要做**: 无

#### `src/utils/permissions/denialTracking.ts` — 已实现 (45 行)

- **状态**: 已完成
- **内容**: 连续/总计拒绝计数跟踪，用于决定何时回退到 prompting
- **需要做**: 补充测试

---

### 2.8 权限规则持久化

#### `src/utils/permissions/permissionsLoader.ts` — 已实现 (296 行)

- **状态**: 已完成
- **内容**: 从 settings.json 文件加载权限规则、规则持久化、企业策略管理（`shouldAllowManagedPermissionRulesOnly`）
- **需要做**: 补充测试

#### `src/utils/permissions/PermissionUpdate.ts` — 已实现 (389 行)

- **状态**: 已完成
- **内容**: 权限更新应用逻辑——`applyPermissionUpdate()` / `applyPermissionUpdates()` / `persistPermissionUpdates()`，将 PermissionUpdate 应用到 ToolPermissionContext 并持久化到 settings 文件
- **需要做**: 补充测试

#### `src/utils/settings/permissionValidation.ts` — 已实现

- **状态**: 已完成
- **内容**: 权限规则字符串的验证逻辑（括号匹配、格式校验等）
- **需要做**: 无

---

### 2.9 权限解释与调试

#### `src/utils/permissions/permissionExplainer.ts` — 已实现 (250 行)

- **状态**: 已完成
- **内容**: 使用 AI 生成权限决策的风险解释（LOW/MEDIUM/HIGH 风险等级），包含 analytics 事件上报
- **需要做**: 无

#### `src/utils/permissions/bypassPermissionsKillswitch.ts` — 已实现 (155 行)

- **状态**: 已完成
- **内容**: 远程禁用 bypass 权限模式的 killswitch，检查 Statsig feature gate
- **需要做**: 无

---

### 2.10 交互式审批

#### `src/hooks/toolPermission/handlers/interactiveHandler.ts` — 已实现

- **状态**: 已完成
- **内容**: 交互式权限审批流，实现了 design.md 中的"竞速模式"
  - 推送 ToolUseConfirm 到 React 确认队列
  - 多通道竞速：Terminal 本地、Bridge（claude.ai）、Channel Relay（IM）、Hooks
  - `createResolveOnce` 原子竞争，第一个响应者胜出
  - 支持 bash classifier 异步检查
- **需要做**: 无

#### `src/hooks/toolPermission/permissionLogging.ts` — 已实现 (238 行)

- **状态**: 已完成
- **内容**: 权限决策的集中式日志记录，扇出到 Statsig analytics、OTel telemetry、代码编辑指标
- **需要做**: 无

#### `src/hooks/useCanUseTool.tsx` — 已实现

- **状态**: 已完成
- **内容**: React hook，编排权限检查流程——调用 `hasPermissionsToUseTool()`，根据结果分发到 interactive / swarm / coordinator 处理器
- **需要做**: 无

---

### 2.11 UI 组件

#### `src/components/permissions/` — 已实现 (~11532 行，79 文件)

- **状态**: 已完成
- **内容**: 完整的终端 UI 组件集合
  - 各工具的权限请求组件：Bash、FileEdit、FileWrite、Filesystem、NotebookEdit、SedEdit、PowerShell、WebFetch、Skill、AskUserQuestion、ComputerUse、EnterPlanMode、ExitPlanMode
  - 通用组件：PermissionDialog、PermissionPrompt、PermissionRequest、PermissionExplanation、PermissionRuleExplanation
  - 规则管理 UI：PermissionRuleList、AddPermissionRules、PermissionRuleInput、PermissionRuleDescription、RecentDenialsTab、WorkspaceTab
  - 文件权限对话框：FilePermissionDialog（含 diff 展示）
- **需要做**: 无（UI 层功能完整）

#### `src/commands/permissions/` — 已实现

- **状态**: 已完成
- **内容**: `/permissions` 命令实现，渲染 PermissionRuleList 组件
- **需要做**: 无

---

### 2.12 Swarm 权限同步

#### `src/utils/swarm/permissionSync.ts` — 已实现

- **状态**: 已完成
- **内容**: 多 agent swarm 中的权限提示同步——worker 通过 mailbox 转发权限请求给 leader
- **需要做**: 无

---

## 三、测试覆盖分析

### 已有测试文件

| 测试文件 | 行数 | 覆盖目标 |
|---------|------|---------|
| `__tests__/permissionRuleParser.test.ts` | 152 | 规则字符串解析/转义 |
| `__tests__/permissions.test.ts` | 165 | 规则查询函数 |
| `__tests__/PermissionMode.test.ts` | 231 | 模式枚举与工具函数 |
| `__tests__/dangerousPatterns.test.ts` | 93 | 危险模式列表 |
| `__tests__/shellRuleMatching.test.ts` | 145 | Shell 规则匹配 |
| **合计** | **786** | |

### 缺少测试的关键模块

| 模块 | 行数 | 优先级 | 难度 |
|------|------|--------|------|
| `permissions.ts` (核心管线) | 1486 | P1 | 高 |
| `permissionSetup.ts` | 1533 | P1 | 高 |
| `filesystem.ts` | 1778 | P1 | 中 |
| `PermissionUpdate.ts` | 389 | P2 | 中 |
| `pathValidation.ts` | 486 | P2 | 中 |
| `permissionsLoader.ts` | 296 | P2 | 中 |
| `classifierDecision.ts` | 98 | P2 | 低 |
| `denialTracking.ts` | 45 | P3 | 低 |
| `shadowedRuleDetection.ts` | 234 | P3 | 中 |

---

## 四、按优先级排序的任务

### P0 — 无需工作（已完成的模块）

以下模块已完整实现且功能稳定，无需额外工作：

1. **类型定义** — `types/permissions.ts`、`PermissionRule.ts`、`PermissionResult.ts`、`PermissionUpdateSchema.ts`
2. **权限模式** — `PermissionMode.ts`、`getNextPermissionMode.ts`
3. **规则解析** — `permissionRuleParser.ts`、`shellRuleMatching.ts`
4. **UI 组件** — `components/permissions/` 全部 79 文件
5. **交互式审批** — `interactiveHandler.ts`、`useCanUseTool.tsx`
6. **命令** — `commands/permissions/`
7. **日志** — `permissionLogging.ts`
8. **Swarm 同步** — `permissionSync.ts`

### P1 — 高优先级（核心安全逻辑测试）

#### 任务 1: 核心权限管线测试
- **目标文件**: `src/utils/permissions/permissions.ts`
- **新建文件**: `src/utils/permissions/__tests__/permissionsPipeline.test.ts`
- **工作内容**:
  1. 测试 `hasPermissionsToUseToolInner()` 的三步检查管线
  2. 验证 deny 规则优先于 ask 规则
  3. 验证 bypassPermissions 模式跳过非强制检查
  4. 验证 alwaysAllow 规则正确匹配
  5. 验证 safetyCheck 类型的 bypass-immune 行为
  6. 验证 passthrough → ask 转换
- **依赖**: 需要 mock `Tool` 对象、`ToolPermissionContext`、`tool.checkPermissions()`
- **风险**: 核心管线依赖大量外部模块（settings、growthbook、sandbox），mock 链较长
- **估计工作量**: 3-5 天

#### 任务 2: 权限上下文初始化测试
- **目标文件**: `src/utils/permissions/permissionSetup.ts`
- **新建文件**: `src/utils/permissions/__tests__/permissionSetup.test.ts`
- **工作内容**:
  1. 测试 `createToolPermissionContext()` 从多个来源正确加载规则
  2. 测试规则优先级（7 种来源的正确合并顺序）
  3. 测试 `transitionPermissionMode()` 的上下文转换
  4. 测试 auto 模式的危险规则剥离
  5. 测试企业策略下的规则限制
- **依赖**: 需要 mock settings 文件系统、GrowthBook feature gates
- **风险**: 依赖外部配置系统较多
- **估计工作量**: 3-4 天

#### 任务 3: 文件系统权限测试
- **目标文件**: `src/utils/permissions/filesystem.ts`
- **新建文件**: `src/utils/permissions/__tests__/filesystem.test.ts`
- **工作内容**:
  1. 测试危险文件/目录检测（`.git`、`.claude`、`.bashrc` 等）
  2. 测试路径遍历攻击检测
  3. 测试 UNC 路径安全检查
  4. 测试工作目录权限校验
  5. 测试 auto 模式下的路径安全检查
- **依赖**: 需要 mock 文件系统操作
- **风险**: 跨平台路径处理逻辑复杂
- **估计工作量**: 2-3 天

### P2 — 中优先级（辅助模块测试与重构）

#### 任务 4: 权限更新逻辑测试
- **目标文件**: `src/utils/permissions/PermissionUpdate.ts`
- **新建文件**: `src/utils/permissions/__tests__/PermissionUpdate.test.ts`
- **工作内容**:
  1. 测试各种 PermissionUpdate 类型的正确应用
  2. 测试规则去重和冲突处理
  3. 测试持久化到 settings 文件
- **估计工作量**: 1-2 天

#### 任务 5: 路径验证测试
- **目标文件**: `src/utils/permissions/pathValidation.ts`
- **新建文件**: `src/utils/permissions/__tests__/pathValidation.test.ts`
- **工作内容**:
  1. 测试各种路径操作类型的验证（read / write / create）
  2. 测试 glob 模式路径处理
  3. 测试跨平台路径兼容性
- **估计工作量**: 1-2 天

#### 任务 6: 规则加载器测试
- **目标文件**: `src/utils/permissions/permissionsLoader.ts`
- **新建文件**: `src/utils/permissions/__tests__/permissionsLoader.test.ts`
- **工作内容**:
  1. 测试从 settings.json 正确加载规则
  2. 测试规则删除和更新
  3. 测试企业策略模式
- **估计工作量**: 1-2 天

#### 任务 7: 核心文件重构
- **目标**: 降低 `permissions.ts`（1486 行）和 `permissionSetup.ts`（1533 行）的复杂度
- **工作内容**:
  1. 从 `permissions.ts` 提取规则查询函数到 `ruleQueries.ts`
  2. 从 `permissions.ts` 提取规则 CRUD 到 `ruleManagement.ts`
  3. 从 `permissionSetup.ts` 提取上下文构建到 `contextBuilder.ts`
  4. 从 `permissionSetup.ts` 提取模式转换到 `modeTransition.ts`
- **风险**: 重构可能引入回归，需要先完成 P1 测试
- **前置依赖**: 任务 1、2
- **估计工作量**: 3-5 天

### P3 — 低优先级（边缘模块）

#### 任务 8: 分类器决策测试
- **目标文件**: `src/utils/permissions/classifierDecision.ts`
- **估计工作量**: 0.5 天

#### 任务 9: 拒绝跟踪测试
- **目标文件**: `src/utils/permissions/denialTracking.ts`
- **估计工作量**: 0.5 天

#### 任务 10: 规则遮蔽检测测试
- **目标文件**: `src/utils/permissions/shadowedRuleDetection.ts`
- **估计工作量**: 1 天

---

## 五、风险与难点

### 5.1 核心管线测试的 Mock 复杂度

`hasPermissionsToUseToolInner()` 依赖链：
- `Tool` 对象（含 `inputSchema`、`checkPermissions()`、`requiresUserInteraction()`）
- `ToolPermissionContext`（含规则集合和模式）
- `SandboxManager`（沙箱状态）
- `GrowthBook`（feature gate 检查）
- `Analytics`（事件上报）

**缓解策略**: 按依赖层级分层 mock，先建立 mock 工厂，再逐层构建测试用例。

### 5.2 Feature Flag 导致的代码分叉

`auto` 模式和 YOLO Classifier 通过 `feature('TRANSCRIPT_CLASSIFIER')` 条件加载，这意味着：
- 外部构建和内部构建走不同的代码路径
- 测试需要覆盖两种路径
- `bashClassifier.ts` 在外部构建中是完全 stub

**缓解策略**: 测试中通过 `mock.module('bun:bundle')` 控制 feature flag 返回值。

### 5.3 文件系统路径的跨平台兼容性

`filesystem.ts` 和 `pathValidation.ts` 处理大量平台特定逻辑：
- UNC 路径（Windows）
- POSIX vs Windows 路径分隔符
- 符号链接解析
- macOS 特有的 `.zshrc`、`.zprofile` 检查

**缓解策略**: 测试用例覆盖主要平台路径格式，使用 `getPlatform()` mock 控制平台行为。

### 5.4 重构的风险

`permissions.ts` 和 `permissionSetup.ts` 各超 1400 行，被大量模块导入。重构时：
- 导入路径变更会影响 50+ 文件
- 函数签名变更需要同步更新所有调用方
- 需要确保现有测试不受影响

**缓解策略**: 使用 re-export 模式保持旧导入路径兼容，分阶段重构。

### 5.5 规则优先级的隐含依赖

7 种规则来源的优先级通过加载顺序隐含实现，而非显式声明。这可能导致：
- 新增来源时难以确定正确位置
- 规则冲突时的行为不直观
- 规则遮蔽检测（`shadowedRuleDetection.ts`）可能遗漏新场景

**缓解策略**: 在 `permissionSetup.ts` 中添加明确的优先级注释文档，或引入显式优先级数值。

---

## 六、架构改进建议（远期）

1. **规则引擎抽象**: 将规则匹配逻辑（deny → ask → allow 的优先级链）抽象为可配置的规则引擎，而非硬编码在 `hasPermissionsToUseToolInner` 中
2. **事件驱动审批**: 将交互式审批从 React 组件直接操作改为事件驱动架构，解耦 UI 和权限逻辑
3. **规则来源元数据**: 为每条规则附加来源和创建时间元数据，便于审计和调试
4. **权限决策日志持久化**: 当前权限决策仅记录到 analytics，建议持久化到本地日志文件，便于事后审计

---

## 七、文件索引

### 核心逻辑文件（`src/utils/permissions/`）

| 文件 | 行数 | 职责 |
|------|------|------|
| `permissions.ts` | 1486 | 核心权限检查管线 |
| `permissionSetup.ts` | 1533 | 上下文初始化与规则加载 |
| `filesystem.ts` | 1778 | 文件系统权限检查 |
| `yoloClassifier.ts` | 1495 | Auto 模式 AI 分类器 |
| `pathValidation.ts` | 486 | 路径验证逻辑 |
| `PermissionUpdate.ts` | 389 | 权限更新应用 |
| `permissionsLoader.ts` | 296 | 规则从 settings 加载 |
| `permissionRuleParser.ts` | 198 | 规则字符串解析 |
| `shadowedRuleDetection.ts` | 234 | 规则遮蔽检测 |
| `shellRuleMatching.ts` | 228 | Shell 规则匹配 |
| `bypassPermissionsKillswitch.ts` | 155 | Bypass 模式远程开关 |
| `permissionExplainer.ts` | 250 | AI 权限解释 |
| `dangerousPatterns.ts` | 80 | 危险命令模式 |
| `getNextPermissionMode.ts` | 101 | 模式循环 |
| `PermissionMode.ts` | 141 | 模式枚举与配置 |
| `classifierDecision.ts` | 98 | Auto 模式允许列表 |
| `PermissionUpdateSchema.ts` | 78 | 更新 Zod schema |
| `PermissionPromptToolResultSchema.ts` | 127 | Prompt Tool schema |
| `bypassPermissionsKillswitch.ts` | 155 | Bypass 远程开关 |
| `autoModeState.ts` | 39 | Auto 模式状态 |
| `classifierShared.ts` | 39 | 分类器共享工具 |
| `denialTracking.ts` | 45 | 拒绝跟踪 |
| `PermissionRule.ts` | 40 | 规则 Zod schema |
| `PermissionResult.ts` | 35 | 结果类型 re-export |
| `bashClassifier.ts` | 61 | Bash 分类器（外部 stub） |

### 类型定义

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/types/permissions.ts` | 442 | 所有权限相关类型定义 |

### UI 组件（`src/components/permissions/`）

- 79 个文件，总计 ~11532 行
- 覆盖所有工具类型的权限请求 UI

### 测试文件（`src/utils/permissions/__tests__/`）

- 5 个文件，总计 786 行
- 覆盖率偏低，核心管线未测试

### 命令入口

| 文件 | 职责 |
|------|------|
| `src/commands/permissions/index.ts` | `/permissions` 命令注册 |
| `src/commands/permissions/permissions.tsx` | `/permissions` 命令实现 |

### Hooks

| 文件 | 职责 |
|------|------|
| `src/hooks/useCanUseTool.tsx` | 权限检查 React hook |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | 交互式审批处理器 |
| `src/hooks/toolPermission/permissionLogging.ts` | 权限决策日志 |
| `src/hooks/toolPermission/PermissionContext.ts` | 权限上下文工具 |
