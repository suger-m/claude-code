# Compaction 服务实施计划

> 基于 `design.md` (V6 四 4.11) 与代码库实际调查
> 优先级: P2
> 风险: 低~中

---

## 一、现状概览

### 代码分布

当前 compaction 相关代码分布在 `src/services/compact/` (16 个文件) 和 `src/query.ts` 中，涉及 UI 组件、命令注册、测试等共 130+ 个文件。

`src/services/compact/` 目录结构：

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `compact.ts` | ~1709 | **已实现** | 核心压缩流程：compactConversation、partialCompactConversation、stripImages、PTL 重试、附件重建 |
| `microCompact.ts` | ~531 | **已实现** | 微压缩：cached MC (cache editing)、time-based MC、token 估算 |
| `autoCompact.ts` | ~352 | **已实现** | 自动压缩：阈值计算、shouldAutoCompact、autoCompactIfNeeded、熔断器 |
| `sessionMemoryCompact.ts` | ~631 | **已实现** | Session Memory 压缩：基于 SM 文件替代传统 API 摘要 |
| `prompt.ts` | ~375 | **已实现** | 摘要 prompt 模板：base/partial/partial_up_to 三种模板，格式化输出 |
| `grouping.ts` | ~64 | **已实现** | 按 API round 分组消息，供 reactive compact 使用 |
| `compactWarningState.ts` | ~19 | **已实现** | 压缩后警告抑制 store |
| `compactWarningHook.ts` | ~17 | **已实现** | React hook 订阅警告状态 |
| `postCompactCleanup.ts` | ~78 | **已实现** | 压缩后缓存/状态清理 |
| `timeBasedMCConfig.ts` | ~44 | **已实现** | Time-based MC GrowthBook 配置 |
| `apiMicrocompact.ts` | ~154 | **已实现** | API-based context management (clear_tool_uses/clear_thinking) |
| `reactiveCompact.ts` | ~23 | **Stub** | Reactive compact：413 prompt-too-long 后重试，函数体为空 |
| `cachedMicrocompact.ts` | ~38 | **Stub** | Cached MC 核心状态机：注册/删除/缓存编辑，函数体为空 |
| `cachedMCConfig.ts` | ~4 | **Stub** | Cached MC GrowthBook 配置，返回空对象 |
| `snipCompact.ts` | ~18 | **Stub** | Snip 精确裁剪策略，函数体为空 |
| `snipProjection.ts` | ~8 | **Stub** | Snip 视图投影（UI 展示用），函数体为空 |

### 设计目标 vs 现状

设计文档提出三种策略模式的 CompactionStrategy：
- **SnipCompaction** (精确裁剪) → `snipCompact.ts` / `snipProjection.ts` 均为 Stub，**未实现**
- **MicroCompaction** (摘要压缩) → `microCompact.ts` + `cachedMicrocompact.ts`，主体已实现，cached MC 核心为 Stub，**部分实现**
- **AutoCompaction** (智能压缩) → `autoCompact.ts` + `compact.ts`，**已实现**

设计文档提出的 ContextWindowManager：
- token 计数/budget 分配 → 散布在 `autoCompact.ts` (getEffectiveContextWindowSize, getAutoCompactThreshold) 和 `microCompact.ts` (estimateMessageTokens) 中，**已实现但分散**
- 触发阈值检测 (80%/90%/95%) → `autoCompact.ts` calculateTokenWarningState，**已实现**
- prompt 构造/摘要请求 → `prompt.ts` + `compact.ts` streamCompactSummary，**已实现**

设计文档的核心诉求："统一到 packages/agent/compaction/" → **未做**，代码仍在 `src/services/compact/`

---

## 二、模块/文件详细分析与任务清单

### P0: 修复 Stub 模块（让现有功能完整工作）

#### 1. `cachedMicrocompact.ts` — Cached Microcompact 核心

- **当前状态**: Stub — 所有函数返回空值/false
- **需要做的工作**:
  - 实现 `createCachedMCState()` — 完整初始化 state (已有类型定义)
  - 实现 `registerToolResult(state, toolId)` — 注册 tool_use_id 到 state.toolOrder 和 state.registeredTools
  - 实现 `registerToolMessage(state, groupIds)` — 将同组 tool IDs 关联
  - 实现 `getToolResultsToDelete(state)` — 根据阈值返回待删除的 tool_use_id 列表
  - 实现 `createCacheEditsBlock(state, toolIds)` — 构造 cache_edits API 块
  - 实现 `isCachedMicrocompactEnabled()` — 检查 feature flag + GrowthBook 开关
  - 实现 `isModelSupportedForCacheEditing(model)` — 检查模型白名单
  - 实现 `getCachedMCConfig()` — 读取 GrowthBook 配置 (triggerThreshold, keepRecent)
  - 实现 `markToolsSentToAPI(state)` — 标记已发送状态
  - 实现 `resetCachedMCState(state)` — 重置状态
- **依赖**:
  - `cachedMCConfig.ts` 需要先实现（配置源）
  - GrowthBook feature flag 系统
  - `microCompact.ts` 中的调用方已就绪
- **风险**: 中 — cache editing 是 Anthropic 内部 API 特性，需要了解 API 协议细节；`cachedMCConfig.ts` 的 GrowthBook experiment key 未知

#### 2. `cachedMCConfig.ts` — Cached MC 配置

- **当前状态**: Stub — 返回空对象
- **需要做的工作**:
  - 从 GrowthBook 读取 `tengu_cached_microcompact` 实验配置
  - 返回 `enabled`, `triggerThreshold`, `keepRecent`, `supportedModels` 等字段
- **依赖**: GrowthBook SDK (已有 `getFeatureValue_CACHED_MAY_BE_STALE`)
- **风险**: 低 — GrowthBook key 需要从 Anthropic 内部获取

#### 3. `reactiveCompact.ts` — Reactive Compact

- **当前状态**: Stub — 所有函数返回 false/null
- **需要做的工作**:
  - 实现 `isReactiveOnlyMode()` — 检查是否仅使用 reactive 模式（禁用 proactive autocompact）
  - 实现 `isReactiveCompactEnabled()` — feature flag 检查
  - 实现 `isWithheldPromptTooLong(message)` — 检测 API 返回的 prompt-too-long 错误
  - 实现 `isWithheldMediaSizeError(message)` — 检测媒体尺寸超限错误
  - 实现 `reactiveCompactOnPromptTooLong(messages, cacheSafeParams, options)` — 核心逻辑：收到 413 后，按 API round 分组从尾部剥离，逐轮重试直到能放进 context window
  - 实现 `tryReactiveCompact(params)` — 在 query loop 中被调用，处理已尝试过的重试
- **依赖**:
  - `grouping.ts` (已有，按 API round 分组)
  - `compact.ts` 的 compactConversation (已有)
  - `query.ts` 中的调用点已通过 `feature('REACTIVE_COMPACT')` 保护
- **风险**: 中 — 需要理解 prompt-too-long 错误的处理路径和分组剥离策略

### P1: 实现 Snip 策略（设计文档核心缺失）

#### 4. `snipCompact.ts` — Snip 精确裁剪

- **当前状态**: Stub — 所有函数返回空值/false
- **需要做的工作**:
  - 实现 `isSnipMarkerMessage(message)` — 识别 snip 标记消息
  - 实现 `isSnipRuntimeEnabled()` — 检查 feature flag
  - 实现 `snipCompactIfNeeded(messages, options?)` — 核心逻辑：
    - 扫描消息中的 snip marker
    - 当 token 使用量接近阈值时，裁剪中间消息（保留首尾）
    - 返回裁剪后的消息数组 + 释放的 token 数
  - 实现 `shouldNudgeForSnips(messages)` — 判断是否需要提示用户执行 snip
  - 定义 `SNIP_NUDGE_TEXT` — 提示文本
- **依赖**:
  - `snipProjection.ts` (需同时实现)
  - `autoCompact.ts` 中已有 `snipTokensFreed` 参数传递
  - `query.ts` 中已有条件导入 (`feature('SNIP_COMPACT')`)
- **风险**: 中 — Snip 是一种较新的裁剪策略，需要精确处理 tool_use/tool_result 配对关系，避免破坏 API invariant

#### 5. `snipProjection.ts` — Snip 视图投影

- **当前状态**: Stub
- **需要做的工作**:
  - 实现 `isSnipBoundaryMessage(message)` — 识别 snip 边界消息
  - 实现 `projectSnippedView(messages)` — 将完整消息列表投影为 snip 后的 UI 视图（折叠被裁剪的消息）
- **依赖**: `snipCompact.ts`，UI 组件 (`Message.tsx` 已有引用)
- **风险**: 低 — 纯展示层逻辑

### P2: 统一到 packages/agent/compaction/（设计文档核心诉求）

#### 6. 包结构重组

- **当前状态**: 代码分散在 `src/services/compact/`、`src/query.ts`、`src/commands/compact/` 等
- **需要做的工作**:
  - 创建 `packages/agent/compaction/` 包目录
  - 迁移核心文件：
    - `compact.ts` → `packages/agent/compaction/core.ts`
    - `autoCompact.ts` → `packages/agent/compaction/auto.ts`
    - `microCompact.ts` → `packages/agent/compaction/micro.ts`
    - `sessionMemoryCompact.ts` → `packages/agent/compaction/sessionMemory.ts`
    - `prompt.ts` → `packages/agent/compaction/prompt.ts`
    - `grouping.ts` → `packages/agent/compaction/grouping.ts`
    - Stub 文件也一并迁移
  - 抽取 ContextWindowManager：
    - 新建 `packages/agent/compaction/contextWindowManager.ts`
    - 整合 `getEffectiveContextWindowSize`、`getAutoCompactThreshold`、`calculateTokenWarningState`、`estimateMessageTokens`
  - 定义 CompactionStrategy 接口：
    - 新建 `packages/agent/compaction/types.ts`
    - 统一 Snip/Micro/Auto 三种策略的接口
  - 更新 `query.ts` 中的调用点（从 `src/services/compact/` 改为 `packages/agent/compaction/`）
  - 更新 `src/commands/compact/compact.ts` 的 import
  - 更新 tsconfig 的 path alias
- **依赖**: P0 和 P1 的 Stub 实现完成后进行，避免迁移过程中引入错误
- **风险**: 高 — 大规模文件移动 + import 路径更新，130+ 个文件引用 compact 相关模块；需要逐步迁移而非一次性切换

### P3: 测试补充

#### 7. 补充单元测试

- **当前状态**: 仅 2 个测试文件（`grouping.test.ts` 6 个用例, `prompt.test.ts` 7 个用例）
- **需要做的工作**:
  - `compact.test.ts` — 测试 stripImagesFromMessages、stripReinjectedAttachments、truncateHeadForPTLRetry、buildPostCompactMessages、mergeHookInstructions、createCompactCanUseTool
  - `autoCompact.test.ts` — 测试 shouldAutoCompact 各种条件分支、autoCompactIfNeeded 熔断器、calculateTokenWarningState 阈值计算
  - `microCompact.test.ts` — 测试 estimateMessageTokens、evaluateTimeBasedTrigger、microcompactMessages（需 mock GrowthBook）
  - `sessionMemoryCompact.test.ts` — 测试 adjustIndexToPreserveAPIInvariants、calculateMessagesToKeepIndex、shouldUseSessionMemoryCompaction
  - `apiMicrocompact.test.ts` — 测试 getAPIContextManagement 策略构建
  - `reactiveCompact.test.ts` — reactive compact 的重试逻辑（实现后）
  - `snipCompact.test.ts` — snip 裁剪逻辑（实现后）
- **依赖**: P0/P1 Stub 实现后
- **风险**: 低 — 纯测试编写，但需要 mock 大量依赖（GrowthBook、API、forkedAgent）

### P4: UI 与命令层对齐

#### 8. UI 组件适配

- **当前状态**: UI 层已基本完成，与当前 compaction 接口一致
- **需要做的工作**:
  - `CompactSummary.tsx` — 无需改动（已支持 summarizeMetadata）
  - `CompactBoundaryMessage.tsx` — 如添加新的 compact 类型（snip），需增加渲染
  - `TokenWarning.tsx` — 如重组 ContextWindowManager，需更新 import 路径
  - `ContextVisualization.tsx` — 可能需要适配新的 compaction 策略可视化
  - `MessageSelector.tsx` — 支持 snip 标记消息的选择交互
- **依赖**: P2 包重组后更新 import
- **风险**: 低

#### 9. 命令层

- **当前状态**: `src/commands/compact/` 已有完整的 `/compact` 命令实现
- **需要做的工作**:
  - 实现 reactive compact 模式的命令路径（已有代码框架，reactiveCompact 调用为 stub）
  - 如重组包结构，更新 import 路径
- **依赖**: P0 reactiveCompact 实现，P2 包重组
- **风险**: 低

---

## 三、优先级排序总结

| 优先级 | 任务 | 工作量估算 | 风险 |
|--------|------|-----------|------|
| **P0-1** | cachedMicrocompact.ts 实现 | 3-5 天 | 中 |
| **P0-2** | cachedMCConfig.ts 实现 | 0.5 天 | 低 |
| **P0-3** | reactiveCompact.ts 实现 | 3-5 天 | 中 |
| **P1-4** | snipCompact.ts 实现 | 3-5 天 | 中 |
| **P1-5** | snipProjection.ts 实现 | 1 天 | 低 |
| **P2-6** | 包结构统一到 packages/agent/compaction/ | 5-7 天 | 高 |
| **P3-7** | 补充单元测试 | 5-7 天 | 低 |
| **P4-8** | UI 组件适配 | 1-2 天 | 低 |
| **P4-9** | 命令层对齐 | 1-2 天 | 低 |

**建议执行顺序**: P0-2 → P0-1 → P0-3 → P1-4 → P1-5 → P3-7 → P2-6 → P4-8/P4-9

理由：先从低风险低工作量的配置模块开始，逐步实现核心功能，在所有功能就绪后再进行包重组（风险最高），最后补测试和 UI 适配。

---

## 四、风险与难点

### 1. GrowthBook 配置键值缺失 (风险: 高)

`cachedMCConfig.ts`、`timeBasedMCConfig.ts`、`sessionMemoryCompact.ts` 都依赖 GrowthBook 远程配置。由于这是反编译项目，GrowthBook 的 experiment key 和默认值不一定准确。实现时需要：
- 从代码中推断 experiment key（已有线索如 `tengu_cached_microcompact`、`tengu_slate_heron`、`tengu_sm_compact_config`）
- 提供合理的本地默认值和 fallback
- 考虑用环境变量 override 机制替代 GrowthBook

### 2. API 协议细节 (风险: 中)

- `cache_edits` 是 Anthropic 内部 API 特性，外部文档可能不完整
- `clear_tool_uses_20250919`、`clear_thinking_20251015` 等 context management strategy 类型是内部 API 参数
- 实现时需要基于现有代码中的类型定义和注释推断协议细节

### 3. tool_use/tool_result 配对完整性 (风险: 中)

`sessionMemoryCompact.ts` 中的 `adjustIndexToPreserveAPIInvariants` 展示了消息裁剪的复杂性：必须保证每个 tool_result 都有对应的 tool_use，反之亦然。Snip compact 和 reactive compact 都需要处理这个约束。已有代码可作为参考。

### 4. 循环依赖 (风险: 中)

`postCompactCleanup.ts` 注释中提到 compact ↔ compactMessages 的循环依赖（CC-1180），包重组时需要特别注意模块初始化顺序。当前通过文件拆分 (`grouping.ts`) 缓解。

### 5. 测试 Mock 复杂度 (风险: 低~中)

compaction 模块依赖链长：GrowthBook → API → forkedAgent → tokenEstimation → messages → hooks。测试需要 mock 多层依赖。参考已有的 `__tests__/prompt.test.ts` 和 `__tests__/grouping.test.ts` 的 mock 模式。

### 6. Feature Flag 交互 (风险: 低)

多个 compaction 路径通过 feature flag 门控：
- `CACHED_MICROCOMPACT` → cached MC
- `REACTIVE_COMPACT` → reactive compact
- `CONTEXT_COLLAPSE` → 抑制 autocompact
- `SNIP_COMPACT` → snip 裁剪 (推断)
- `PROMPT_CACHE_BREAK_DETECTION` → 缓存断裂检测

多条路径之间存在互斥和优先级关系（例如 reactive-only 模式下禁用 proactive autocompact），实现时需要确保逻辑一致性。

---

## 五、关键文件路径索引

### 核心实现（已实现）
- `/src/services/compact/compact.ts` — 压缩主流程 (1709 行)
- `/src/services/compact/autoCompact.ts` — 自动压缩阈值与调度 (352 行)
- `/src/services/compact/microCompact.ts` — 微压缩 (531 行)
- `/src/services/compact/sessionMemoryCompact.ts` — Session Memory 压缩 (631 行)
- `/src/services/compact/prompt.ts` — 摘要 prompt 模板 (375 行)
- `/src/services/compact/grouping.ts` — 消息分组 (64 行)
- `/src/services/compact/apiMicrocompact.ts` — API context management (154 行)
- `/src/services/compact/postCompactCleanup.ts` — 压缩后清理 (78 行)
- `/src/services/compact/timeBasedMCConfig.ts` — Time-based MC 配置 (44 行)
- `/src/services/compact/compactWarningState.ts` — 警告抑制 store (19 行)
- `/src/services/compact/compactWarningHook.ts` — React hook (17 行)

### Stub（待实现）
- `/src/services/compact/reactiveCompact.ts` — Reactive compact (23 行 stub)
- `/src/services/compact/cachedMicrocompact.ts` — Cached MC 核心 (38 行 stub)
- `/src/services/compact/cachedMCConfig.ts` — Cached MC 配置 (4 行 stub)
- `/src/services/compact/snipCompact.ts` — Snip 裁剪 (18 行 stub)
- `/src/services/compact/snipProjection.ts` — Snip 视图投影 (8 行 stub)

### 调用方
- `/src/query.ts` — 主查询循环，调用 microcompact 和 autocompact
- `/src/QueryEngine.ts` — QueryEngine 编排层，处理 compact boundary 消息
- `/src/commands/compact/compact.ts` — `/compact` 命令实现
- `/src/commands/compact/index.ts` — 命令注册

### UI 组件
- `/src/components/CompactSummary.tsx` — 压缩摘要展示
- `/src/components/messages/CompactBoundaryMessage.tsx` — 边界消息展示
- `/src/components/TokenWarning.tsx` — Token 用量警告
- `/src/components/ContextVisualization.tsx` — 上下文可视化

### 测试
- `/src/services/compact/__tests__/grouping.test.ts` — 分组测试
- `/src/services/compact/__tests__/prompt.test.ts` — Prompt 格式化测试
