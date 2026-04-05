# Tool Registry 实现计划

> 来源: V6.md 4.3 / specs/feature-tool-registry/design.md
> 优先级: P1
> 风险: 低

## 一、概述

将当前 `src/tools.ts` 中 `getAllBaseTools()` 的硬编码工具列表（54 个工具，20 常驻 + 34 条件加载）重构为统一的 `ToolRegistry` 注册中心。目标是实现工具的解耦注册/注销、动态发现和统一接口，同时保持现有功能的完整性和 prompt-cache 稳定性。

## 二、现状分析

### 2.1 核心文件及其职责

| 文件 | 职责 | 当前行数 |
|------|------|----------|
| `src/Tool.ts` | `Tool` 接口定义、`buildTool()` 工厂函数、`findToolByName()`、`toolMatchesName()` | ~793 |
| `src/tools.ts` | `getAllBaseTools()` 硬编码列表、`getTools()` 权限过滤、`assembleToolPool()` 合并内建+MCP、`filterToolsByDenyRules()` | ~388 |
| `src/constants/tools.ts` | 工具名常量、`ALL_AGENT_DISALLOWED_TOOLS`、`ASYNC_AGENT_ALLOWED_TOOLS`、`COORDINATOR_MODE_ALLOWED_TOOLS` 等白名单集合 | ~111 |
| `src/hooks/useMergedTools.ts` | React hook，调用 `assembleToolPool()` + `mergeAndFilterTools()` | ~45 |
| `src/utils/toolPool.ts` | 纯函数 `mergeAndFilterTools()`、coordinator 模式过滤 | ~80 |
| `src/utils/toolSearch.ts` | 动态延迟工具发现（ToolSearchTool 机制） | ~757 |
| `src/services/tools/toolExecution.ts` | 工具执行流水线（权限检查 -> hook -> call -> 结果处理） | ~1746 |
| `src/tools/AgentTool/agentToolUtils.ts` | `filterToolsForAgent()`、`resolveAgentTools()` — 子代理工具过滤 | ~688 |
| `src/tools/MCPTool/MCPTool.ts` | MCP 工具模板，`buildTool()` 构建，运行时由 `client.ts` 动态覆写属性 | ~78 |
| `src/services/mcp/client.ts` | MCP 工具的动态创建：将 MCP server 返回的工具列表映射为 `Tool` 对象 | 大量 |

### 2.2 当前工具注册流程

1. **内建工具**: `tools.ts` 顶部静态 `import` 所有工具模块 + `require()` 条件加载
2. **MCP 工具**: `services/mcp/client.ts` 中动态创建，基于 `MCPTool` 模板展开
3. **合并**: `assembleToolPool()` 将内建 + MCP 合并，按名称排序去重
4. **过滤**: `getTools()` 应用权限 deny 规则、REPL 模式隐藏、`isEnabled()` 检查
5. **子代理过滤**: `filterToolsForAgent()` 根据代理类型进一步裁剪工具列表

### 2.3 已有基础

- `Tool` 接口非常完整（`call`, `checkPermissions`, `isEnabled`, `isReadOnly`, `prompt`, `description` 等 40+ 方法/属性）
- `buildTool()` 工厂函数提供安全的默认值
- MCP 工具已证明动态注册模式的可行性（运行时从模板创建 Tool 对象）
- ToolSearchTool 机制已实现延迟工具发现
- 权限过滤链（deny rules -> isEnabled -> REPL mode）成熟稳定

## 三、目标架构

```
┌─────────────────────────────────────────────────────┐
│                  ToolRegistry (单例)                 │
│                                                     │
│  register(tool)       unregister(name)              │
│  get(name)→Tool       getAll()→Tools                │
│  getByCategory(cat)   getEnabled(permissionCtx)     │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              发现机制 (Provider)               │  │
│  │  1. BuiltInToolsProvider   ── 静态注册        │  │
│  │  2. McpToolsProvider       ── 动态加载 (已有) │  │
│  │  3. PluginToolsProvider    ── npm 包 + 配置   │  │
│  │  4. UserToolsProvider      ── ~/.claude/      │  │
│  └───────────────────────────────────────────────┘  │
│                       │                              │
│                       ▼                              │
│            统一 Tool 接口 (不变)                      │
│            call() / checkPermissions()               │
│            isEnabled() / isReadOnly()                │
└─────────────────────────────────────────────────────┘
```

## 四、需要实现的模块/文件

### P0: 核心 ToolRegistry 类（必须先完成）

#### 4.1 `src/tools/registry/ToolRegistry.ts`

- **当前状态**: 未实现
- **工作内容**:
  - 创建 `ToolRegistry` 类，提供 `register(tool)`、`unregister(name)`、`get(name)`、`getAll()` 方法
  - 内部维护 `Map<string, Tool>` 存储
  - 支持按名称查找（含 alias 查找）
  - 提供 `getEnabledTools(permissionContext)` 方法，整合当前 `getTools()` 的逻辑
  - 提供 `assemblePool(permissionContext, mcpTools)` 方法，整合当前 `assembleToolPool()` 的逻辑
  - 支持工具注册/注销的事件回调（`onRegister`, `onUnregister`），用于 UI 刷新
- **依赖**: `src/Tool.ts`（Tool 接口）
- **风险**: 低 — 纯增量代码，不修改现有接口

#### 4.2 `src/tools/registry/types.ts`

- **当前状态**: 未实现
- **工作内容**:
  - 定义 `ToolProvider` 接口：`{ name: string, discover(): Promise<Tool[]> }`
  - 定义 `ToolCategory` 枚举：`'builtin' | 'mcp' | 'plugin' | 'user'`
  - 定义 `ToolRegistration` 类型：`{ tool: Tool, category: ToolCategory, provider: string }`
- **依赖**: `src/Tool.ts`
- **风险**: 无

#### 4.3 `src/tools/registry/index.ts`

- **当前状态**: 未实现
- **工作内容**: 导出 `ToolRegistry`、`toolRegistry`（单例实例）及相关类型
- **依赖**: 4.1, 4.2

### P1: Provider 实现

#### 4.4 `src/tools/registry/providers/BuiltInToolsProvider.ts`

- **当前状态**: 部分实现（逻辑散落在 `tools.ts` 的 `getAllBaseTools()` 中）
- **工作内容**:
  - 将 `getAllBaseTools()` 中的工具列表提取为 `BuiltInToolsProvider`
  - 保留所有 `feature()` / `process.env` 条件加载逻辑
  - `discover()` 方法返回所有当前环境可用的内建工具
  - 支持增量注册（避免一次性加载所有工具模块）
- **依赖**: 4.2（ToolProvider 接口），所有工具模块（BashTool, FileReadTool 等）
- **风险**: 中 — 需要仔细保持与当前 `getAllBaseTools()` 行为一致，包括：
  - `hasEmbeddedSearchTools()` 下隐藏 GlobTool/GrepTool
  - `isTodoV2Enabled()` 下加载 Task 系列工具
  - `isPowerShellToolEnabled()` 下加载 PowerShellTool
  - `isWorktreeModeEnabled()` 下加载 worktree 工具
  - `isToolSearchEnabledOptimistic()` 下加载 ToolSearchTool
  - 所有 `feature()` 门控的工具
  - 所有 `process.env.USER_TYPE === 'ant'` 门控的工具
- **难点**: 条件逻辑复杂，约 15 种条件分支

#### 4.5 `src/tools/registry/providers/McpToolsProvider.ts`

- **当前状态**: 大部分已实现（`services/mcp/client.ts` 中已有动态工具创建）
- **工作内容**:
  - 将 MCP 工具创建逻辑封装为 `McpToolsProvider`
  - `discover()` 调用现有 MCP 客户端连接逻辑，返回 `Tool[]`
  - 保留现有 MCP 工具动态创建模板（`MCPTool` + 属性覆写）
  - 保留 `mcpInfo` 元数据
- **依赖**: 4.2, `src/services/mcp/client.ts`, `src/tools/MCPTool/MCPTool.ts`
- **风险**: 低 — 包装现有逻辑

#### 4.6 `src/tools/registry/providers/PluginToolsProvider.ts`

- **当前状态**: 未实现（设计文档中的未来扩展）
- **工作内容**:
  - 从 npm 包或本地配置发现和加载工具
  - 支持配置文件声明插件工具（如 `.claude/plugins.json`）
  - 沙箱执行隔离
- **依赖**: 4.2
- **风险**: 高 — 插件安全模型需要仔细设计
- **建议**: 第一版可先创建 stub，后续迭代实现

#### 4.7 `src/tools/registry/providers/UserToolsProvider.ts`

- **当前状态**: 未实现（设计文档中的未来扩展）
- **工作内容**:
  - 从 `~/.claude/tools/` 目录发现用户自定义工具
  - 支持用户编写自定义工具脚本
- **依赖**: 4.2
- **风险**: 中 — 需定义用户工具的接口和沙箱
- **建议**: 第一版可先创建 stub，后续迭代实现

### P2: 迁移现有代码到 ToolRegistry

#### 4.8 迁移 `src/tools.ts`

- **当前状态**: 完整实现，需要重构
- **工作内容**:
  - `getAllBaseTools()` → 委托给 `BuiltInToolsProvider.discover()`
  - `getTools()` → 委托给 `toolRegistry.getEnabledTools(permissionContext)`
  - `assembleToolPool()` → 委托给 `toolRegistry.assemblePool(permissionContext, mcpTools)`
  - `filterToolsByDenyRules()` → 移入 `ToolRegistry` 类方法
  - `getToolsForDefaultPreset()` → 委托给 `toolRegistry`
  - 保留所有 `export` 以保持向后兼容（过渡期）
  - 保留 `TOOL_PRESETS` 和 `parseToolPreset()`
- **依赖**: 4.3, 4.4
- **风险**: 高 — 被广泛引用（25+ 文件），需要逐一验证调用点
- **难点**: 需要确保行为完全一致，特别是：
  - prompt-cache 排序稳定性（按名称排序 + built-in 前缀连续性）
  - REPL 模式工具隐藏逻辑
  - Simple 模式工具子集
  - Coordinator 模式工具过滤

#### 4.9 迁移 `src/hooks/useMergedTools.ts`

- **当前状态**: 完整实现
- **工作内容**:
  - 将 `assembleToolPool()` 调用改为 `toolRegistry.assemblePool()`
  - 将 `mergeAndFilterTools()` 调用改为 registry 方法
  - 保持 React hook 接口不变
- **依赖**: 4.8
- **风险**: 低

#### 4.10 迁移 `src/utils/toolPool.ts`

- **当前状态**: 完整实现
- **工作内容**:
  - `mergeAndFilterTools()` → 移入 `ToolRegistry` 或保留为独立纯函数
  - `applyCoordinatorToolFilter()` → 可保留在 constants/tools.ts 或移入 registry
- **依赖**: 4.8
- **风险**: 低

#### 4.11 迁移 `src/services/tools/toolExecution.ts`

- **当前状态**: 完整实现
- **工作内容**:
  - `runToolUse()` 中的 `findToolByName()` 调用可改为 `toolRegistry.get(name)`
  - `getAllBaseTools()` 回退查找可改为 `toolRegistry.getAll()`
  - 保持异步生成器接口不变
- **依赖**: 4.8
- **风险**: 中 — 工具执行是核心路径，需要充分测试

### P3: 工具过滤与权限整合

#### 4.12 `src/tools/registry/filtering.ts`

- **当前状态**: 逻辑分散在多个文件中
- **工作内容**:
  - 整合 `filterToolsByDenyRules()`（来自 tools.ts）
  - 整合 `filterToolsForAgent()`（来自 agentToolUtils.ts）
  - 整合 `applyCoordinatorToolFilter()`（来自 toolPool.ts）
  - 整合 REPL-only tools 隐藏逻辑
  - 整合 Simple 模式工具子集逻辑
  - 整合 `isEnabled()` 过滤
  - 统一为可组合的过滤器管道
- **依赖**: 4.1, `src/constants/tools.ts`
- **风险**: 中 — 过滤逻辑是安全边界，需要保持严格一致

#### 4.13 `src/constants/tools.ts` 更新

- **当前状态**: 完整实现
- **工作内容**:
  - 工具名常量保持不变（跨模块引用）
  - `ALL_AGENT_DISALLOWED_TOOLS` 等集合可考虑从 registry 动态获取（可选优化）
  - 添加 `ToolCategory` 到工具名常量的映射（可选）
- **依赖**: 无
- **风险**: 低 — 主要保持现状

### P4: 测试

#### 4.14 `src/tools/registry/__tests__/ToolRegistry.test.ts`

- **当前状态**: 未实现
- **工作内容**:
  - 测试 `register()` / `unregister()` / `get()` / `getAll()`
  - 测试 alias 查找
  - 测试 `getEnabledTools()` 过滤逻辑
  - 测试 `assemblePool()` 合并逻辑
  - 测试并发安全（多 provider 同时注册）
  - 测试事件回调
- **依赖**: 4.1
- **风险**: 无

#### 4.15 `src/tools/registry/__tests__/BuiltInToolsProvider.test.ts`

- **当前状态**: 未实现（现有 `src/__tests__/tools.test.ts` 覆盖部分逻辑）
- **工作内容**:
  - 测试各 feature flag 条件下的工具列表
  - 测试 `hasEmbeddedSearchTools()` 隐藏 Glob/Grep
  - 测试 `isTodoV2Enabled()` 加载 Task 工具
  - 测试 `isToolSearchEnabledOptimistic()` 加载 ToolSearchTool
  - 测试所有 `process.env.USER_TYPE === 'ant'` 条件
- **依赖**: 4.4
- **风险**: 低

#### 4.16 `src/tools/registry/__tests__/filtering.test.ts`

- **当前状态**: 部分实现（`src/__tests__/tools.test.ts` 中有 `filterToolsByDenyRules` 测试）
- **工作内容**:
  - 迁移并扩展现有测试
  - 测试 filter pipeline 组合
  - 测试 coordinator 模式过滤
  - 测试 agent 工具过滤
- **依赖**: 4.12
- **风险**: 无

## 五、实施顺序

```
Phase 1 (基础): 4.2 → 4.1 → 4.3 → 4.14
                 类型定义   Registry类   导出   测试

Phase 2 (Provider): 4.4 → 4.5 → 4.15
                     BuiltIn   MCP   测试

Phase 3 (迁移):   4.12 → 4.8 → 4.10 → 4.9 → 4.11
                  过滤整合   tools.ts  toolPool  useMerged  toolExecution

Phase 4 (扩展):   4.6 → 4.7
                  Plugin   User (stub)

Phase 5 (验证):   4.13 → 4.16 → 全面集成测试
                  常量更新   过滤测试
```

## 六、风险与难点

### 6.1 高风险

1. **prompt-cache 稳定性**: 当前 `assembleToolPool()` 按 `a.name.localeCompare(b.name)` 排序，确保内建工具作为连续前缀。Registry 必须保持完全一致的排序策略。任何排序变化都会导致所有下游 cache key 失效。
   - **缓解**: 在 `ToolRegistry.assemblePool()` 中保留现有排序逻辑，添加排序稳定性测试。

2. **向后兼容性**: `src/tools.ts` 被 25+ 文件引用，`getAllBaseTools` / `getTools` / `assembleToolPool` / `filterToolsByDenyRules` 是核心 API。迁移期间必须保持所有现有 export 不变。
   - **缓解**: Phase 3 迁移期间保留所有现有 export 作为委托，逐步迁移调用方。

3. **条件加载逻辑复杂度**: `getAllBaseTools()` 有约 15 种条件分支（feature flag、环境变量、用户类型），遗漏任何一个都会导致工具缺失。
   - **缓解**: 将 `BuiltInToolsProvider` 的行为与当前 `getAllBaseTools()` 做快照对比测试。

### 6.2 中风险

4. **工具执行路径**: `toolExecution.ts` 的 `runToolUse()` 是核心执行路径，修改查找逻辑需要确保不影响工具调用性能。
   - **缓解**: Registry 使用 Map 查找（O(1)），不劣于当前 `Array.find()`（O(n)）。

5. **动态 MCP 工具**: MCP 工具在运行时动态添加/移除（服务器连接/断开），Registry 需要支持这种动态性。
   - **缓解**: Registry 设计为支持 `register()`/`unregister()` 的动态操作，与现有 MCP 生命周期一致。

### 6.3 低风险

6. **类型安全**: `Tool` 接口使用泛型（`Tool<Input, Output, P>`），Registry 需要处理异构工具集合的类型擦除。
   - **缓解**: 已有 `Tools = readonly Tool[]` 类型，Registry 使用相同模式。

## 七、验收标准

1. `ToolRegistry` 类可通过 `register()`/`unregister()`/`get()`/`getAll()` 管理工具
2. `BuiltInToolsProvider` 产出的工具列表与当前 `getAllBaseTools()` 完全一致
3. `McpToolsProvider` 包装现有 MCP 工具发现逻辑，行为不变
4. `assemblePool()` 输出的工具排序与当前实现一致（prompt-cache 稳定）
5. 所有现有测试通过（1623 tests / 0 fail）
6. 新增 Registry 相关测试覆盖核心方法
7. `src/tools.ts` 的所有现有 export 保持可用（过渡期）

## 八、不在范围内

- PluginToolsProvider 和 UserToolsProvider 的完整实现（仅 stub）
- 工具版本管理
- 工具依赖声明系统
- 热重载（HMR）支持
- 跨会话工具持久化
