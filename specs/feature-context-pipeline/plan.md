# Context Pipeline 实施计划

> 基于 `design.md` 和代码库现状的详细实施规划
> 优先级: P2 | 风险: 低

## 一、现状分析

### 1.1 当前架构（As-Is）

上下文装配分散在多个文件中，没有统一的 Provider 接口：

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/context.ts` | 提供 `getSystemContext()` (gitStatus) 和 `getUserContext()` (CLAUDE.md + 日期) | ~189 |
| `src/utils/claudemd.ts` | CLAUDE.md 文件发现、解析、层级加载、@include 解析 | ~1480 |
| `src/constants/prompts.ts` | `getSystemPrompt()` 组装完整 system prompt 各个 section | ~800+ |
| `src/utils/systemPrompt.ts` | `buildEffectiveSystemPrompt()` 选择使用哪个 system prompt（coordinator/agent/custom/default） | ~123 |
| `src/services/api/claude.ts` | `buildSystemPromptBlocks()` 将 system prompt 字符串拆分为 API 缓存分块 | ~3415 |
| `src/utils/queryContext.ts` | `fetchSystemPromptParts()` 在 QueryEngine 和 side question 之间共享的 prompt 获取逻辑 | ~180 |
| `src/constants/system.ts` | `getCLISyspromptPrefix()` 和 `getAttributionHeader()` | ~96 |
| `src/utils/analyzeContext.ts` | `analyzeContextUsage()` 上下文窗口分析，可视化各类 token 占比 | ~1386 |
| `src/utils/contextAnalysis.ts` | `analyzeContext()` 消息级 token 统计 | ~273 |
| `src/utils/contextSuggestions.ts` | `generateContextSuggestions()` 基于上下文分析生成优化建议 | ~236 |
| `src/utils/context.ts` | 模型上下文窗口大小、max output tokens 计算 | ~223 |

### 1.2 数据流（当前）

```
getSystemPrompt(tools, model)     →  systemPrompt: string[]   (各 section)
getUserContext()                  →  userContext: { claudeMd, currentDate }
getSystemContext()                →  systemContext: { gitStatus, cacheBreaker }
                    ↓
buildEffectiveSystemPrompt()      →  选择最终 system prompt (agent/custom/default)
                    ↓
buildSystemPromptBlocks()         →  TextBlockParam[] (API 缓存分块)
```

### 1.3 核心问题

1. **无统一接口**: git status、CLAUDE.md、日期、attribution 各自独立获取，没有统一 Provider 契约
2. **无自定义 hook 点**: 用户无法注册自定义 context provider
3. **装配逻辑分散**: prompt section 在 `prompts.ts` 的 `getSystemPrompt()` 中通过硬编码 section 列表组装
4. **缓存感知不足**: `buildSystemPromptBlocks()` 只做简单的分块和缓存标记，不感知每个 provider 的变更频率
5. **测试困难**: 各 provider 耦合在函数内部，无法单独测试或替换

## 二、目标架构（To-Be）

```
┌──────────────────────────────────────────────────┐
│                  ContextPipeline                  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │         ContextProvider[]                  │  │
│  │   (按 priority 排序, 可插拔)               │  │
│  │                                            │  │
│  │   ┌─ AttributionProvider ─ priority: 0    │  │
│  │   ├─ CLISyspromptProvider ─ priority: 1   │  │
│  │   ├─ GitStatusProvider ──── priority: 10  │  │
│  │   ├─ ClaudeMdProvider ──── priority: 20   │  │
│  │   ├─ DateProvider ──────── priority: 30   │  │
│  │   ├─ SessionGuidanceProvider priority: 40 │  │
│  │   ├─ MCPInstructionsProvider priority: 50 │  │
│  │   ├─ LanguageProvider ──── priority: 60   │  │
│  │   ├─ OutputStyleProvider ─ priority: 70   │  │
│  │   ├─ ScratchpadProvider ── priority: 80   │  │
│  │   ├─ MemoryProvider ────── priority: 90   │  │
│  │   └─ CustomProvider ────── priority: 99   │  │
│  │         (用户通过配置注册)                  │  │
│  └────────────────────────────────────────────┘  │
│                      │                           │
│                      ▼                           │
│          ContextPipelineResult                    │
│   { systemBlocks, userContext, systemContext }   │
│                      │                           │
│                      ▼                           │
│              buildSystemPromptBlocks()            │
│          (API 缓存分块, 已有实现)                 │
└──────────────────────────────────────────────────┘
```

## 三、模块实施计划

### 3.1 ContextProvider 接口定义

**文件**: `src/context/ContextProvider.ts`（新建）
**状态**: 未实现
**优先级**: P0（基础接口）

**说明**:
> 注意: `src/context/` 目录已**已存在**但但**仅包含 UI 相关的 React context providers**（如 `notifications.tsx`, `QueuedMessageContext.tsx`, `fpsMetrics.tsx`, `mailbox.tsx`, `modalContext.tsx`, `overlayContext.tsx`, `promptOverlayContext.tsx`, `stats.tsx`, `voice.tsx`），这些与 Context Pipeline 无关。需要新建单独的目录 `src/context/providers/````typescript
// 核心接口
interface ContextProvider {
  /** 唯一标识 */
  id: string
  /** 排序优先级，数字越小越先执行 */
  priority: number
  /** 提供的上下文类型 */
  type: 'system' | 'user' | 'system_prompt_section'
  /** 是否缓存结果（memoize） */
  cacheable: boolean
  /** 获取上下文内容 */
  provide(ctx: ProviderContext): Promise<ProviderResult>
}

interface ProviderContext {
  tools: Tools
  model: string
  additionalWorkingDirectories: string[]
  mcpClients: MCPServerConnection[]
  settings: Settings
}

interface ProviderResult {
  /** 用于 system prompt 的文本块 */
  systemPromptSection?: string
  /** 用于 user context 的键值对 */
  userContext?: Record<string, string>
  /** 用于 system context 的键值对 */
  systemContext?: Record<string, string>
}
```

**工作内容**:
- 定义 `ContextProvider` 接口及辅助类型
- 定义 `ProviderContext` 上下文对象
- 定义 `ProviderResult` 返回结构

**依赖**: 无

**风险**: 低。纯类型定义，不影响现有代码

---

### 3.2 ContextPipeline 核心

**文件**: `src/context/ContextPipeline.ts`（新建）
**状态**: 未实现
**优先级**: P0（核心调度）

**工作内容**:
- 实现 `ContextPipeline` 类，管理 provider 注册、排序、执行
- 支持按 priority 排序执行所有 provider
- 支持缓存策略（cacheable provider 只执行一次）
- 提供 `registerProvider()` 方法供外部注册自定义 provider
- 提供 `execute()` 方法返回 `ContextPipelineResult`
- 支持缓存失效（`clearCache()`）

**依赖**: 3.1 ContextProvider 接口

**风险**: 低。新文件，不影响现有代码

---

### 3.3 GitStatusProvider

**文件**: `src/context/providers/GitStatusProvider.ts`（新建）
**状态**: 已有实现（在 `src/context.ts` 的 `getGitStatus()` 中）
**优先级**: P1

**工作内容**:
- 将 `src/context.ts` 中的 `getGitStatus()` 提取为 `GitStatusProvider`
- 实现 `ContextProvider` 接口
- 迁移 memoize 逻辑到 provider 的 cacheable 属性
- 迁移 `MAX_STATUS_CHARS` 常量
- 迁移诊断日志（`logForDiagnosticsNoPII`）

**依赖**: 3.1, 3.2

**当前代码位置**: `src/context.ts:36-111`

---

### 3.4 ClaudeMdProvider

**文件**: `src/context/providers/ClaudeMdProvider.ts`（新建）
**状态**: 已有实现（在 `src/context.ts` 的 `getUserContext()` 和 `src/utils/claudemd.ts` 中）
**优先级**: P1

**工作内容**:
- 将 `getUserContext()` 中的 CLAUDE.md 获取逻辑提取为 `ClaudeMdProvider`
- 保持对 `src/utils/claudemd.ts` 的依赖（该文件 1480 行，包含完整的 CLAUDE.md 发现和解析逻辑，暂不拆分）
- 迁移 `shouldDisableClaudeMd` 判断逻辑
- 迁移 `setCachedClaudeMdContent()` 调用

**依赖**: 3.1, 3.2
**外部依赖**: `src/utils/claudemd.ts`（不变）

**当前代码位置**: `src/context.ts:155-189`

---

### 3.5 DateProvider

**文件**: `src/context/providers/DateProvider.ts`（新建）
**状态**: 已有实现（在 `src/context.ts` 的 `getUserContext()` 中）
**优先级**: P1

**工作内容**:
- 将日期上下文（`currentDate: Today's date is ${getLocalISODate()}.`）提取为独立 provider
- 最简单的 provider，适合作为第一个实现验证接口

**依赖**: 3.1, 3.2

**当前代码位置**: `src/context.ts:186`

---

### 3.6 AttributionProvider

**文件**: `src/context/providers/AttributionProvider.ts`（新建）
**状态**: 已有实现（在 `src/constants/system.ts` 和 `src/services/api/claude.ts` 的 queryModel 中）
**优先级**: P2

**工作内容**:
- 将 attribution header 逻辑（`getAttributionHeader()`）封装为 provider
- 注意: 当前 attribution header 是在 `queryModel()` 中拼接到 systemPrompt 数组的，不在 `getSystemPrompt()` 中
- 需要决定是保持现状（在 API 层注入）还是迁移到 pipeline（在 context 层注入）

**依赖**: 3.1, 3.2

**当前代码位置**: `src/services/api/claude.ts:1354-1365`（system prompt 拼接处）

---

### 3.7 CLISyspromptProvider

**文件**: `src/context/providers/CLISyspromptProvider.ts`（新建）
**状态**: 已有实现（在 `src/constants/system.ts` 的 `getCLISyspromptPrefix()` 中）
**优先级**: P2

**工作内容**:
- 将 CLI system prompt 前缀封装为 provider
- 处理三种前缀变体（DEFAULT_PREFIX, AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX, AGENT_SDK_PREFIX）
- 注意: 当前前缀也是在 `queryModel()` 中注入的，不在 `getSystemPrompt()` 中

**依赖**: 3.1, 3.2

---

### 3.8 SystemPromptSection Providers

**文件**: `src/context/providers/*.ts`（多个新建文件）
**状态**: 已有实现（在 `src/constants/prompts.ts` 的 `getSystemPrompt()` 中）
**优先级**: P2

**工作内容**:

将 `getSystemPrompt()` 中的各 section 提取为独立 provider:

| Provider | 当前 section | 说明 |
|----------|-------------|------|
| `SessionGuidanceProvider` | `getSessionSpecificGuidanceSection()` | 会话指引 |
| `MemoryProvider` | `loadMemoryPrompt()` | 记忆系统 prompt |
| `LanguageProvider` | `getLanguageSection()` | 语言偏好 |
| `OutputStyleProvider` | `getOutputStyleSection()` | 输出风格 |
| `MCPInstructionsProvider` | `getMcpInstructionsSection()` | MCP 指令 |
| `ScratchpadProvider` | `getScratchpadInstructions()` | 临时文件指令 |
| `FunctionResultClearingProvider` | `getFunctionResultClearingSection()` | FRC 指令 |
| `SummarizeToolResultsProvider` | `SUMMARIZE_TOOL_RESULTS_SECTION` | 工具结果摘要 |

注意: `src/constants/prompts.ts` 已有 `systemPromptSection()` 和 `DANGEROUS_uncachedSystemPromptSection()` 的概念（命名 + 缓存策略），新的 Provider 接口需要兼容这套机制。

**依赖**: 3.1, 3.2, 3.5（先实现 DateProvider 验证接口）

---

### 3.9 CustomProvider 注册机制

**文件**: `src/context/CustomProviderRegistry.ts`（新建）
**状态**: 未实现
**优先级**: P2

**工作内容**:
- 定义用户自定义 provider 的配置 schema
- 支持通过项目配置（`.claude/settings.json`）注册自定义 provider
- 自定义 provider 可以是:
  - 简单文本文件（指定路径）
  - Shell 命令（执行后 stdout 作为内容）
  - 未来: HTTP endpoint
- 支持条件加载（如仅在特定目录下生效）

**依赖**: 3.1, 3.2

**配置示例**:
```json
{
  "contextProviders": [
    {
      "id": "project-context",
      "priority": 25,
      "type": "file",
      "path": ".claude/context.md"
    },
    {
      "id": "api-docs",
      "priority": 55,
      "type": "command",
      "command": "generate-api-docs.sh"
    }
  ]
}
```

---

### 3.10 Pipeline 集成

**文件**: 多文件修改
**状态**: 未实现
**优先级**: P2

**工作内容**:

1. **修改 `src/constants/prompts.ts`**: 让 `getSystemPrompt()` 使用 pipeline 执行 providers，而非硬编码 section 列表
2. **修改 `src/context.ts`**: 让 `getSystemContext()` 和 `getUserContext()` 从 pipeline 获取结果
3. **修改 `src/utils/queryContext.ts`**: 让 `fetchSystemPromptParts()` 使用统一的 pipeline 接口
4. **修改 `src/services/api/claude.ts`**: `queryModel()` 中的 system prompt 拼接逻辑简化（attribution 和 prefix 已由 pipeline 提供）
5. **保持向后兼容**: 过渡期保留旧的 `getSystemContext()` 和 `getUserContext()` 函数签名

**依赖**: 3.1 ~ 3.8 全部完成

---

### 3.11 测试

**文件**: `src/context/__tests__/`（新建目录）
**状态**: 未实现
**优先级**: P1（随各模块同步编写）

**工作内容**:
- `ContextPipeline.test.ts`: 测试 provider 注册、排序、执行、缓存
- `GitStatusProvider.test.ts`: 测试 git status 获取、截断、非 git 仓库处理
- `ClaudeMdProvider.test.ts`: 测试 CLAUDE.md 发现、过滤、禁用
- `DateProvider.test.ts`: 测试日期格式
- `CustomProviderRegistry.test.ts`: 测试自定义 provider 注册和执行
- 集成测试: 测试完整 pipeline 执行

---

### 3.12 文档和类型导出

**文件**: `src/context/index.ts`（新建）
**状态**: 未实现
**优先级**: P2

**工作内容**:
- 导出 `ContextProvider`、`ContextPipeline`、所有内置 provider
- 导出辅助类型
- 导出注册自定义 provider 的工具函数

---

### 3.13 `src/constants/systemPromptSections.ts` 缓存机制分析

**文件**: `src/constants/systemPromptSections.ts`（已有）
**状态**: 已实现
**优先级**: 了解（影响迁移策略）

`systemPromptSections.ts` (68 行) 提供了 `systemPromptSection()` 和 `DANGEROUS_uncachedSystemPromptSection()` 缓存机制，其功能与 Context Pipeline 设计的 provider `cacheable` 属性高度一致:

| 函数 | 说明 | 缓存 |
|------|------|------|
| `systemPromptSection(name, compute)` | 创建缓存型 section | `cacheBreak: false` (缓存直到 /clear) |
| `DANGEROUS_uncachedSystemPromptSection(name, compute, reason)` | 创建非缓存型 section | `cacheBreak: true` (每次都重新计算) |

缓存依赖 `bootstrap/state.ts` 中的 `systemPromptSectionCache: Map<string, string | null>`， 在 `/clear` 和 `/compact` 时通过 `clearSystemPromptSections()` 清除。

 迁移时， Context Pipeline 的 provider 需要复用这套缓存基础设施而非重新发明。

---

### 3.14 `src/constants/prompts.ts` section 完整清单

**文件**: `src/constants/prompts.ts`（已有， ~800 行）
**状态**: 已实现
**优先级**: 了解（映射 provider 对应关系）

`getSystemPrompt()` 返回的所有 section 及其缓存属性（按实际代码顺序）:

| Section 名称 | 功能 | `cacheBreak` |
|---|---|---|
| `session_guidance` | 会话指引 | false |
| `memory` | 记忆系统 prompt | false |
| `ant_model_override` | ant model 覆盖 | false |
| `env_info_simple` | 模型/环境信息 | false |
| `language` | 语言偏好 | false |
| `output_style` | 输出风格 | false |
| `mcp_instructions` | MCP 指令 (动态) | **true** |
| `scratchpad` | 临时文件指令 | false |
| `frc` | FRC 指令 | false |
| `summarize_tool_results` | 工具结果摘要 | false |
| `tool_descriptions` | 工具描述 (动态) | **true** |
| `session_guidance` (extra) | 额外会话指引 | **true** |
| `brief` | Brief prompt (KAIROS) | **true** |
| `explore_agent` | Explore agent 指令 | **true** |

这些 section 与设计文档中 Provider 的对应关系:
- `SessionGuidanceProvider` -> `session_guidance`
- `MemoryProvider` -> `memory`
- `LanguageProvider` -> `language`
- `OutputStyleProvider` -> `output_style`
- `MCPInstructionsProvider` -> `mcp_instructions`
- `ScratchpadProvider` -> `scratchpad`
- `FunctionResultClearingProvider` -> `frc`
- `SummarizeToolResultsProvider` -> `summarize_tool_results`

---

### 3.15 `src/services/api/openai/` 兼容性

**文件**: `src/services/api/openai/`（已有）
**状态**: 已实现
**优先级**: P2（集成阶段需验证)

OpenAI 兼容层有自己的 system prompt 处理:
- `openai/index.ts` 的 `queryModelOpenAI()` 接收 `SystemPrompt` 类型参数
- 但它最终仍使用 `buildSystemPromptBlocks()` 进行分块
- Pipeline 输出的原始文本格式对两种 API 都兼容
- **需要在集成阶段验证 OpenAI 适配器是否正常工作**

---

### 3.16 目录位置与 V6.md Phase 分**

V6.md 将 Context Pipeline 放在 Phase 4 (`packages/provider/`) 中。 但当前 `src/context/` 目录已包含 UI 相关文件 (notifications.tsx, QueuedMessageContext.tsx 等). 建议:
- **Phase 1**: 在 `src/context/providers/` 下实现各 provider (新目录)
- **Phase 4**: 迁移到 `packages/provider/` 中
- 或者: 直接在 `packages/provider/` 下新建 `context/` 子目录

需要避免与现有 UI 文件混淆

 采用后一种方案更合理

---

### 3.17 Stub 文件同步风险

 **文件**: `src/utils/src/context.ts`, `src/components/agents/src/context.ts`, `src/screens/src/utils/context.ts`, `src/services/api/src/utils/context.ts`
**状态**: 已存在（auto-generated type stub）
**优先级**: 了解（不阻塞实施)

这些是 auto-generated type stub 文件，内容为:
```typescript
export type getSystemContext = any;
export type getUserContext = any;
```

它们使用不同的 import 路径（如 `src/utils/src/context` vs `src/context`), 不会影响运行时. 但如果重构 `src/context.ts` 并重命名导出函数， 需要检查这些 stub 是否需要同步更新. 实际上， 这些 stub 可能可以通过检查是否有代码 import 它它们来确认是否需要关注.**文件**: `src/context/index.ts`（新建）
**状态**: 未实现
**优先级**: P2

**工作内容**:
- 导出 `ContextProvider`、`ContextPipeline`、所有内置 provider
- 导出辅助类型
- 导出注册自定义 provider 的工具函数

---

## 四、实施路线图

### Phase 1: 基础设施（预估 2-3 天）

1. 定义 `ContextProvider` 接口（3.1）
2. 实现 `ContextPipeline` 核心（3.2）
3. 实现 `DateProvider`（3.5）— 最简单，用于验证接口
4. 编写基础测试（3.11）

### Phase 2: 迁移现有 Provider（预估 3-5 天）

5. 实现 `GitStatusProvider`（3.3）
6. 实现 `ClaudeMdProvider`（3.4）
7. 实现 `AttributionProvider`（3.6）
8. 实现 `CLISyspromptProvider`（3.7）
9. 编写对应测试（3.11）

### Phase 3: System Prompt Section Provider 迁移（预估 5-7 天）

10. 逐个实现 SystemPromptSection Providers（3.8）
11. 编写对应测试

### Phase 4: 集成和自定义 Provider（预估 3-5 天）

12. Pipeline 集成到现有调用点（3.10）
13. 实现自定义 Provider 注册机制（3.9）
14. 导出公共 API（3.12）
15. 集成测试

---

## 五、风险和难点

### 5.1 Prompt 缓存兼容性（风险: 高）

**问题**: `buildSystemPromptBlocks()` 使用缓存分块策略（`splitSysPromptPrefix`），将 system prompt 拆分为 global-cacheable 和 dynamic 两部分。如果 pipeline 输出的 section 顺序或内容发生变化，会导致缓存失效，增加 token 消耗。

**缓解措施**:
- Provider 的 priority 必须精确反映缓存需求（static 内容在前，dynamic 在后）
- 在 pipeline 中内置 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 支持
- 对比测试：确保迁移前后 system prompt 的 token 数量一致

### 5.2 `src/utils/claudemd.ts` 耦合（风险: 中）

**问题**: `claudemd.ts` 有 1480 行，被 `getUserContext()`、`analyzeContext.ts`、`yoloClassifier.ts` 等多处引用。ClaudeMdProvider 需要小心处理这些依赖关系。

**缓解措施**: Phase 2 只将 `getUserContext()` 中的调用点迁移，保持 `claudemd.ts` 不变。后续再考虑拆分。

### 5.3 并发安全（风险: 低）

**问题**: `getSystemContext()` 和 `getUserContext()` 使用 `lodash memoize`，在 pipeline 中需要类似的缓存机制。`setSystemPromptInjection()` 需要能清除缓存。

**缓解措施**: Pipeline 的 `cacheable` 属性 + `clearCache()` 方法覆盖此场景。

### 5.4 OpenAI 兼容层（风险: 低）

**问题**: OpenAI 兼容层（`src/services/api/openai/index.ts`）有自己的 system prompt 处理逻辑。需要确保 pipeline 输出对两种 API 格式都兼容。

**缓解措施**: Pipeline 输出的是原始文本，`buildSystemPromptBlocks()` 负责格式转换，与当前架构一致。

### 5.5 System Prompt 动态边界（风险: 中）

**问题**: `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记（在 `src/constants/prompts.ts:115-116`）分隔可缓存和不可缓存内容。迁移 section provider 时必须正确处理这个边界。

**缓解措施**: 在 provider 接口中增加 `cacheScope` 属性（'global' | 'session' | 'ephemeral'），pipeline 自动插入边界标记。

### 5.6 Feature Flag 交互（风险: 低）

**问题**: 很多 section 受 feature flag 控制（如 proactive mode、KAIROS、advisor 等）。Provider 需要感知 feature flag 状态。

**缓解措施**: `ProviderContext` 包含 feature flag 信息，每个 provider 在 `provide()` 中自行检查。

---

## 六、验收标准

1. **接口定义**: `ContextProvider` 接口清晰，TypeScript 类型完整
2. **向后兼容**: 迁移后 `getSystemPrompt()`、`getSystemContext()`、`getUserContext()` 输出与迁移前一致
3. **缓存效率**: System prompt 缓存命中率不下降（对比迁移前后的 `cache_read_input_tokens`）
4. **可扩展**: 用户可通过配置文件注册自定义 context provider
5. **测试覆盖**: 所有内置 provider 有独立单元测试，pipeline 有集成测试
6. **无性能退化**: context 获取时间不超过当前实现（各 provider 可并行执行）

---

## 七、涉及的文件清单

### 新建文件

| 文件路径 | 说明 |
|---------|------|
| `src/context/ContextProvider.ts` | Provider 接口和辅助类型 |
| `src/context/ContextPipeline.ts` | Pipeline 核心调度 |
| `src/context/CustomProviderRegistry.ts` | 自定义 provider 注册 |
| `src/context/index.ts` | 公共 API 导出 |
| `src/context/providers/GitStatusProvider.ts` | Git 状态 provider |
| `src/context/providers/ClaudeMdProvider.ts` | CLAUDE.md provider |
| `src/context/providers/DateProvider.ts` | 日期 provider |
| `src/context/providers/AttributionProvider.ts` | Attribution header provider |
| `src/context/providers/CLISyspromptProvider.ts` | CLI prompt 前缀 provider |
| `src/context/providers/SessionGuidanceProvider.ts` | 会话指引 provider |
| `src/context/providers/MemoryProvider.ts` | 记忆系统 prompt provider |
| `src/context/providers/LanguageProvider.ts` | 语言偏好 provider |
| `src/context/providers/OutputStyleProvider.ts` | 输出风格 provider |
| `src/context/providers/MCPInstructionsProvider.ts` | MCP 指令 provider |
| `src/context/providers/ScratchpadProvider.ts` | 临时文件 provider |
| `src/context/__tests__/ContextPipeline.test.ts` | Pipeline 测试 |
| `src/context/__tests__/providers/*.test.ts` | 各 provider 测试 |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/context.ts` | 迁移 getGitStatus/getUserContext/getSystemContext 到 provider，保留向后兼容的包装函数 |
| `src/constants/prompts.ts` | getSystemPrompt() 使用 pipeline 替代硬编码 section 列表 |
| `src/utils/queryContext.ts` | fetchSystemPromptParts() 使用 pipeline 统一接口 |
| `src/services/api/claude.ts` | queryModel() 简化 system prompt 拼接逻辑 |
| `src/utils/systemPrompt.ts` | buildEffectiveSystemPrompt() 适配 pipeline 输出 |
