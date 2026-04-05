# Hook 生命周期模块化 — 实施计划

> 基于 `design.md` 和代码库实际状态调查
> 日期: 2026-04-05

## 一、现状概览

### 当前代码分布

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/utils/hooks.ts` | 5177 | **核心巨型文件** — 包含所有 27 种 hook 事件的执行函数、shell 命令执行、JSON 解析、超时/中断处理、matcher 匹配逻辑 |
| `src/utils/hooks/sessionHooks.ts` | 447 | 会话级 hook 注册/移除/查询（含 FunctionHook 回调机制） |
| `src/utils/hooks/hooksConfigManager.ts` | 400 | Hook 事件元数据定义（描述、matcher 字段）、分组/排序逻辑 |
| `src/utils/hooks/execAgentHook.ts` | 339 | Agent 类型 hook 执行（LLM 验证 + 结构化输出） |
| `src/utils/hooks/AsyncHookRegistry.ts` | 309 | 异步 hook 注册/轮询/清理 |
| `src/utils/hooks/ssrfGuard.ts` | 294 | HTTP hook 的 SSRF 防护（DNS 黑名单） |
| `src/utils/hooks/hooksSettings.ts` | 271 | Hook 配置查询（从 settings 源聚合）、UI 展示辅助 |
| `src/utils/hooks/skillImprovement.ts` | 267 | Skill 改进建议（post-sampling API query hook） |
| `src/utils/hooks/execHttpHook.ts` | 242 | HTTP 类型 hook 执行 |
| `src/utils/hooks/execPromptHook.ts` | 211 | Prompt 类型 hook 执行（LLM 调用） |
| `src/utils/hooks/hookEvents.ts` | 192 | 事件广播系统（SDK 消息投递） |
| `src/utils/hooks/fileChangedWatcher.ts` | 191 | FileChanged/CwdChanged 文件监听 |
| `src/utils/hooks/apiQueryHookHelper.ts` | 141 | API query hook 通用框架 |
| `src/utils/hooks/hooksConfigSnapshot.ts` | 133 | Hook 配置快照（启动时捕获，热加载） |
| `src/utils/hooks/hookHelpers.ts` | 83 | 结构化输出工具、参数替换等共享辅助 |
| `src/utils/hooks/postSamplingHooks.ts` | 70 | Post-sampling 内部 hook 注册表 |
| `src/utils/hooks/registerFrontmatterHooks.ts` | 67 | Agent/Skill frontmatter hook 注册 |
| `src/utils/hooks/registerSkillHooks.ts` | 64 | Skill hook 注册（含 once 自动移除） |
| **合计** | **~8891** | |

### 类型/Schema 文件

| 文件 | 职责 |
|------|------|
| `src/types/hooks.ts` | Hook 回调类型、HookResult/AggregatedHookResult、Prompt 请求/响应、权限相关类型 |
| `src/schemas/hooks.ts` | Zod schema — 4 种 hook 类型（command/prompt/agent/http）、HookMatcher、HooksSettings |
| `src/entrypoints/agentSdkTypes.js` | HOOK_EVENTS 常量（27 种事件）、各 HookInput 类型定义 |

### 调用方集成点

| 调用方 | 调用的 Hook 函数 |
|--------|-----------------|
| `src/services/tools/toolHooks.ts` | `executePreToolHooks`, `executePostToolHooks`, `executePostToolUseFailureHooks` |
| `src/query/stopHooks.ts` | `executeStopHooks`, `executeTeammateIdleHooks`, `executeTaskCreatedHooks`, `executeTaskCompletedHooks` |
| `src/utils/sessionStart.ts` | `executeSessionStartHooks`, `executeSetupHooks` |
| `src/utils/processUserInput/processUserInput.ts` | `executeUserPromptSubmitHooks` |
| `src/services/compact/compact.ts` | `executePreCompactHooks`, `executePostCompactHooks` |
| `src/query.ts` | `executePostSamplingHooks`, `executeStopFailureHooks` |
| `src/services/notifier.ts` | `executeNotificationHooks` |
| `src/commands/clear/conversation.ts` | `executeSessionEndHooks` |
| `src/services/mcp/elicitationHandler.ts` | `executeElicitationHooks`, `executeElicitationResultHooks` |

### 核心问题

1. **`hooks.ts` 过于庞大（5177 行）** — 27 种 `execute*` 函数 + shell 执行引擎 + matcher 逻辑 + JSON 解析全部混在一个文件中
2. **事件类型硬编码** — `getMatchingHooks` 内有巨大的 `switch(hookInput.hook_event_name)` 处理所有 27 种事件的 matchQuery 逻辑
3. **难以扩展和测试** — 每增加一种 hook 事件需要在多个位置添加代码
4. **packages/agent 不存在** — 设计文档中提到的目标路径 `packages/agent/hooks/` 目前未创建

---

## 二、目标架构

按照 design.md 的规划，将 hook 系统提取为独立模块。考虑到 `packages/agent` 目前不存在且创建它是一个更大的架构决策，本计划将模块化限定在 `src/utils/hooks/` 目录内的重组，保持与现有调用方的兼容性。

### 目标目录结构

```
src/utils/hooks/
  core/
    executor.ts          — Hook 执行引擎（shell spawn、JSON 解析、超时）
    matcher.ts           — Matcher 匹配逻辑
    types.ts             — 内部共享类型
    config.ts            — Hook 配置加载与聚合
  events/
    index.ts             — 事件注册表（声明式定义）
    toolEvents.ts        — PreToolUse / PostToolUse / PostToolUseFailure / PermissionRequest / PermissionDenied
    sessionEvents.ts     — SessionStart / SessionEnd / Setup / UserPromptSubmit / Stop / StopFailure
    compactEvents.ts     — PreCompact / PostCompact
    agentEvents.ts       — SubagentStart / SubagentStop
    teamEvents.ts        — TeammateIdle / TaskCreated / TaskCompleted
    notificationEvents.ts— Notification
    permissionEvents.ts  — PermissionRequest / Elicitation / ElicitationResult
    envEvents.ts         — CwdChanged / FileChanged / ConfigChange / InstructionsLoaded
    worktreeEvents.ts    — WorktreeCreate / WorktreeRemove
  executors/
    commandHook.ts       — Shell command hook 执行（从 hooks.ts execCommandHook 提取）
    promptHook.ts        — Prompt hook 执行（已存在，保持）
    agentHook.ts         — Agent hook 执行（已存在，保持）
    httpHook.ts          — HTTP hook 执行（已存在，保持）
    functionHook.ts      — Function callback hook 执行
  hooksConfigManager.ts  — 保持
  hooksSettings.ts       — 保持
  hooksConfigSnapshot.ts — 保持
  sessionHooks.ts        — 保持
  AsyncHookRegistry.ts   — 保持
  hookEvents.ts          — 保持（事件广播）
  fileChangedWatcher.ts  — 保持
  ssrfGuard.ts           — 保持
  hookHelpers.ts         — 保持
  postSamplingHooks.ts   — 保持
  registerFrontmatterHooks.ts — 保持
  registerSkillHooks.ts  — 保持
  skillImprovement.ts    — 保持
  apiQueryHookHelper.ts  — 保持
  index.ts               — 统一导出（保持与现有 import 兼容）
```

---

## 三、模块详细计划

### Phase 1: 提取执行引擎（优先级 P0）

#### 1.1 `core/executor.ts` — 从 hooks.ts 提取

**当前状态**: 未实现（代码在 hooks.ts 第 185~830 行）

**需要做的工作**:
- 提取 `execCommandHook()` 函数（~500 行）— 负责子进程 spawn、环境变量构建、CLAUDE_ENV_FILE 处理
- 提取 `executeInBackground()` 函数
- 提取 `processHookJSONOutput()` 函数 — 解析 hook 的 JSON 输出
- 提取 `validateHookJson()` 函数
- 提取 `parseHookOutput()` / `parseHttpHookOutput()` 函数
- 提取 `createBaseHookInput()` 函数

**依赖**: 无外部依赖，被所有 event executor 调用

**风险**:
- `execCommandHook` 内部引用了大量模块级变量和辅助函数（`TOOL_HOOK_EXECUTION_TIMEOUT_MS`、shell 路径查找、环境变量构建等），提取时需要确保所有依赖正确传递
- 函数签名变化可能导致调用方需要调整参数

#### 1.2 `core/matcher.ts` — 从 hooks.ts 提取

**当前状态**: 未实现（代码在 hooks.ts 第 1484~1739 行）

**需要做的工作**:
- 提取 `matchesPattern()` — glob 风格的 matcher 匹配
- 提取 `prepareIfConditionMatcher()` — `if` 条件预处理
- 提取 `getMatchingHooks()` — 核心 hook 查找函数（~200 行）
- 提取 `isInternalHook()` / `hookDedupKey()` / `getPluginHookCounts()` / `getHookTypeCounts()`
- 提取 `getHooksConfig()` / `hasHookForEvent()`

**依赖**: `core/types.ts`

#### 1.3 `core/types.ts` — 内部共享类型

**当前状态**: 未实现

**需要做的工作**:
- 从 hooks.ts 提取 `MatchedHook` 类型
- 从 hooks.ts 提取 `HookOutsideReplResult` 类型
- 提取其他内部接口

**依赖**: `src/types/hooks.ts`、`src/entrypoints/agentSdkTypes.js`

#### 1.4 `core/config.ts` — 配置加载

**当前状态**: 未实现（代码分散在 hooks.ts 和 hooksConfigSnapshot.ts）

**需要做的工作**:
- 提取 `shouldSkipHookDueToTrust()` — workspace 信任检查
- 整合配置快照逻辑

**依赖**: `hooksConfigSnapshot.ts`

---

### Phase 2: 按事件类型拆分执行函数（优先级 P1）

#### 2.1 `events/toolEvents.ts` — 工具相关事件

**当前状态**: 未实现（代码在 hooks.ts 中）

**需要做的工作**:
- 提取 `executePreToolHooks()` — 生成器函数（~56 行）
- 提取 `executePostToolHooks()` — 生成器函数（~42 行）
- 提取 `executePostToolUseFailureHooks()` — 生成器函数（~37 行）
- 提取 `executePermissionDeniedHooks()` — 生成器函数（~41 行）
- 提取 `getPreToolHookBlockingMessage()` — 辅助消息构建

**依赖**: Phase 1（core/executor、core/matcher）

**风险**: 这些是生成器函数（`async function*`），需要在提取后保持相同的迭代协议

#### 2.2 `events/sessionEvents.ts` — 会话生命周期事件

**当前状态**: 未实现（代码在 hooks.ts 中）

**需要做的工作**:
- 提取 `executeSessionStartHooks()` — 生成器函数
- 提取 `executeSetupHooks()` — 生成器函数
- 提取 `executeSessionEndHooks()` — 异步函数（非生成器）
- 提取 `executeUserPromptSubmitHooks()` — 生成器函数
- 提取 `executeStopHooks()` — 生成器函数（~74 行，较复杂，包含 SubagentStop 分支）
- 提取 `executeStopFailureHooks()` — 异步函数（fire-and-forget）
- 提取 `getUserPromptSubmitHookBlockingMessage()` — 辅助函数

**依赖**: Phase 1

**风险**: `executeStopHooks` 根据 agentId 自动路由到 SubagentStop，逻辑较复杂

#### 2.3 `events/compactEvents.ts` — 压缩相关事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executePreCompactHooks()` — 异步函数
- 提取 `executePostCompactHooks()` — 异步函数

**依赖**: Phase 1

#### 2.4 `events/agentEvents.ts` — 子 Agent 事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executeSubagentStartHooks()` — 生成器函数

**依赖**: Phase 1

#### 2.5 `events/teamEvents.ts` — 团队协作事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executeTeammateIdleHooks()` — 生成器函数
- 提取 `executeTaskCreatedHooks()` — 生成器函数
- 提取 `executeTaskCompletedHooks()` — 生成器函数
- 提取对应的消息构建辅助函数

**依赖**: Phase 1

#### 2.6 `events/notificationEvents.ts` — 通知事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executeNotificationHooks()` — 异步函数

**依赖**: Phase 1

#### 2.7 `events/permissionEvents.ts` — 权限事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executePermissionRequestHooks()` — 生成器函数
- 提取 `executeElicitationHooks()` — 异步函数
- 提取 `executeElicitationResultHooks()` — 异步函数
- 提取 `parseElicitationHookOutput()` — 辅助函数

**依赖**: Phase 1

#### 2.8 `events/envEvents.ts` — 环境相关事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executeCwdChangedHooks()` — 同步调用 executeHooksOutsideREPL
- 提取 `executeFileChangedHooks()` — 同步调用 executeHooksOutsideREPL
- 提取 `executeConfigChangeHooks()` — 异步函数
- 提取 `executeInstructionsLoadedHooks()` — 异步函数
- 提取 `hasInstructionsLoadedHook()` — 辅助函数

**依赖**: Phase 1

#### 2.9 `events/worktreeEvents.ts` — Worktree 事件

**当前状态**: 未实现

**需要做的工作**:
- 提取 `executeWorktreeCreateHook()` — 异步函数
- 提取 `executeWorktreeRemoveHook()` — 异步函数
- 提取 `hasWorktreeCreateHook()` — 辅助函数

**依赖**: Phase 1

#### 2.10 `events/index.ts` — 事件注册表

**当前状态**: 未实现

**需要做的工作**:
- 创建声明式事件注册机制，替代 `getMatchingHooks` 中的 `switch` 语句
- 每个事件声明自己的 `matchQueryField`（从 hookInput 的哪个字段取 matcher 查询值）
- 这样新增事件只需添加一行声明，无需修改 switch

---

### Phase 3: 提取独立执行器（优先级 P2）

#### 3.1 `executors/commandHook.ts`

**当前状态**: 未实现（代码在 hooks.ts 的 `execCommandHook` 中，约 500 行）

**需要做的工作**:
- 从 hooks.ts 提取完整的 shell 命令执行逻辑
- 包括：环境变量构建（CLAUDE_ENV_FILE、session ID、transcript path 等）
- 包括：Bash/PowerShell 分派
- 包括：Windows 路径转换
- 包括：输出收集与超时处理

**依赖**: `core/executor.ts`

**风险**: 这是最大、最复杂的函数，包含大量平台特定逻辑和边界处理

#### 3.2 `executors/functionHook.ts`

**当前状态**: 未实现（代码在 hooks.ts 第 4895~4994 行）

**需要做的工作**:
- 提取 `executeFunctionHook()` — 内存回调函数 hook 执行
- 提取 `executeHookCallback()` — 通用回调执行包装

**依赖**: `core/types.ts`

---

### Phase 4: 兼容层与清理（优先级 P3）

#### 4.1 `index.ts` — 统一导出

**当前状态**: 未实现

**需要做的工作**:
- 创建 `src/utils/hooks/index.ts`，从各子模块 re-export 所有公开 API
- 确保所有 30 个调用方的 `import { ... } from '../../utils/hooks.js'` 仍然有效
- 实际上需要将 `hooks.ts` 改为薄代理文件，从 hooks/ 目录 re-export

**依赖**: Phase 1-3 全部完成

**风险**: 这是破坏性最大的步骤，如果 re-export 不完整会导致运行时错误。建议采用渐进式替换策略。

#### 4.2 清理 `hooks.ts`

**当前状态**: 5177 行巨型文件

**需要做的工作**:
- Phase 1-3 完成后，hooks.ts 应只保留 re-export 语句
- 逐步迁移调用方的 import 路径（从 `../../utils/hooks.js` → `../../utils/hooks/events/sessionEvents.js` 等）
- 最终 hooks.ts 变为空壳或完全删除

**风险**: 渐进式迁移需要仔细追踪所有调用方

---

### Phase 5: 声明式事件系统（优先级 P4，可选增强）

#### 5.1 声明式事件注册

**当前状态**: 未实现

**需要做的工作**:
- 定义 `HookEventDefinition` 接口：
  ```typescript
  type HookEventDefinition<TInput extends HookInput = HookInput> = {
    name: string
    matchQueryField?: keyof TInput  // 替代 switch
    isGenerator?: boolean           // 是否为 async function*
    isFireAndForget?: boolean       // 是否忽略输出
    blockingErrorsIgnored?: boolean // 是否忽略阻塞错误
    defaultTimeout?: number
  }
  ```
- 创建事件注册表 `HOOK_EVENT_REGISTRY: Record<HookEvent, HookEventDefinition>`
- 用注册表驱动 `getMatchingHooks` 的 matchQuery 逻辑，消除 switch 语句
- 用注册表驱动通用 `executeHooksForEvent` 函数，减少每个事件的样板代码

**依赖**: Phase 2 完成

**风险**: 可能过度抽象，现有 27 种事件的执行逻辑差异较大（有些是生成器、有些是 async、有些支持阻塞、有些 fire-and-forget），强行统一可能增加复杂度

---

## 四、测试现状与计划

### 现有测试覆盖

- `src/utils/__tests__/collapseHookSummaries.test.ts` — 与 hook 相关但非核心
- `src/tools/PowerShellTool/__tests__/gitSafety.test.ts` — 间接测试 PreToolUse hook
- 无专门的 `hooks.test.ts`

### 需要新增的测试

| 优先级 | 测试目标 | 说明 |
|--------|---------|------|
| P0 | `core/executor.ts` | 测试 JSON 解析、超时处理、abort 处理 |
| P0 | `core/matcher.ts` | 测试 glob 匹配、`if` 条件评估 |
| P1 | 各 event executor | 每个提取出的 `execute*` 函数的基础测试 |
| P2 | 兼容层 | 验证所有 re-export 正确 |

---

## 五、风险与难点

### 高风险

1. **循环依赖** — `hooks.ts` 当前 import 了约 40 个模块，被约 30 个模块 import。提取子模块时极易引入循环依赖。必须先用工具检测每次改动后的依赖图。

2. **生成器函数协议** — 多个 `execute*` 函数是 `async function*`（生成器），被调用方通过 `for await...of` 消费。提取后必须保持完全相同的迭代协议，包括 yield 的消息格式和顺序。

3. **环境变量副作用** — `execCommandHook` 通过 `CLAUDE_ENV_FILE` 机制实现跨进程环境变量传递，涉及文件系统操作和缓存失效，逻辑隐蔽且易出错。

### 中风险

4. **调用方兼容性** — 约 30 个文件 import from `../../utils/hooks.js`，如果一次性改路径风险极大。应先用 re-export 兼容层，再渐进迁移。

5. **TypeScript 类型** — 反编译代码有大量 `unknown`/`never` 类型，hook 系统的类型定义分散在 `types/hooks.ts`、`schemas/hooks.ts`、`entrypoints/agentSdkTypes.js`、`settings/types.ts` 四个位置，统一类型可能暴露潜在的类型错误。

6. **`executeHooksOutsideREPL` 与 `executeHooks` 的差异** — 前者不 yield 消息给模型，后者会。两种执行路径的逻辑不完全对称，提取时需要确保分类正确。

### 低风险

7. **hooksConfigManager.ts 的重复内容** — 该文件和 hooks.ts 中的 `getMatchingHooks` 都包含相同的 matchQuery 字段映射（都需要 `if (hookEvent === 'PreToolUse')` 式判断），提取时需同步更新。

---

## 六、实施顺序（推荐）

```
Week 1:
  1. 创建 core/types.ts — 提取内部类型定义
  2. 创建 core/matcher.ts — 提取 matcher 相关函数
  3. 创建 core/executor.ts — 提取执行引擎基础函数
  4. 验证: 运行 bun test 确保无回归

Week 2:
  5. 创建 events/toolEvents.ts — 提取工具相关事件
  6. 创建 events/sessionEvents.ts — 提取会话相关事件
  7. 创建 events/compactEvents.ts + events/agentEvents.ts
  8. 验证: 运行完整测试套件

Week 3:
  9. 创建 events/ 剩余文件 (team, notification, permission, env, worktree)
  10. 创建 executors/commandHook.ts
  11. 创建 executors/functionHook.ts
  12. 验证: 运行完整测试套件

Week 4:
  13. 创建 index.ts 兼容导出层
  14. 将 hooks.ts 瘦身为 re-export 代理
  15. 增量迁移调用方 import 路径（可选）
  16. 最终验证 + 补充测试
```

---

## 七、不改动的文件（保持原样）

以下文件已经是独立的，职责清晰，不需要重构：

- `src/utils/hooks/sessionHooks.ts` — 会话 hook 管理
- `src/utils/hooks/AsyncHookRegistry.ts` — 异步 hook 注册
- `src/utils/hooks/hooksConfigSnapshot.ts` — 配置快照
- `src/utils/hooks/hooksSettings.ts` — 设置查询
- `src/utils/hooks/hooksConfigManager.ts` — 事件元数据（在 Phase 5 可考虑声明式改造）
- `src/utils/hooks/hookEvents.ts` — 事件广播
- `src/utils/hooks/fileChangedWatcher.ts` — 文件监听
- `src/utils/hooks/ssrfGuard.ts` — SSRF 防护
- `src/utils/hooks/hookHelpers.ts` — 辅助工具
- `src/utils/hooks/postSamplingHooks.ts` — Post-sampling hook
- `src/utils/hooks/registerFrontmatterHooks.ts` — Frontmatter hook 注册
- `src/utils/hooks/registerSkillHooks.ts` — Skill hook 注册
- `src/utils/hooks/skillImprovement.ts` — Skill 改进
- `src/utils/hooks/apiQueryHookHelper.ts` — API query 辅助
- `src/utils/hooks/execPromptHook.ts` — Prompt hook 执行
- `src/utils/hooks/execAgentHook.ts` — Agent hook 执行
- `src/utils/hooks/execHttpHook.ts` — HTTP hook 执行
- `src/types/hooks.ts` — 类型定义
- `src/schemas/hooks.ts` — Zod schema
- `src/entrypoints/agentSdkTypes.js` — SDK 类型常量
