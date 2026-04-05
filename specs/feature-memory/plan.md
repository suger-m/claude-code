# 记忆系统实现计划

> 基于 `design.md` 设计文档与代码库实际调查结果
> 调查日期: 2026-04-05

---

## 一、总体评估

记忆系统的核心代码**已经完整实现**，分布在 6 个主要模块中，约 24 个文件。所有设计文档中描述的功能在代码中都有对应实现。当前状态可以总结为：

- **核心存储抽象 (memdir/)**: 完整实现，9 个文件
- **后台记忆提取 (extractMemories/)**: 完整实现，2 个文件
- **记忆合并/清理 (autoDream/)**: 完整实现，4 个文件
- **团队记忆同步 (teamMemorySync/)**: 完整实现，4 个文件
- **后台任务 UI (DreamTask/)**: 完整实现，1 个文件
- **辅助工具函数**: 完整实现，4+ 个文件
- **CLI 命令 & 技能**: 完整实现
- **单元测试**: **缺失** — 未发现任何记忆相关的测试文件

---

## 二、模块详细分析

### 2.1 核心存储抽象 — `src/memdir/` (9 文件, ~1743 行)

| 文件 | 状态 | 说明 |
|------|------|------|
| `memdir.ts` | **已实现** | 主入口。构建记忆 prompt (`buildMemoryPrompt`, `loadMemoryPrompt`)、MEMORY.md 截断逻辑 (200行/25KB)、目录创建保障 (`ensureMemoryDirExists`)、KAIROS 模式的日志 prompt。依赖 `feature('TEAMMEM')` 条件加载团队记忆 |
| `memoryTypes.ts` | **已实现** | 四类型分类法 (user/feedback/project/reference)、两种 prompt 模板 (COMBINED/INDIVIDUAL)、"What NOT to save"/"When to access"/"Before recommending from memory" 等关键指导段落。完整且精细 |
| `paths.ts` | **已实现** | 路径解析与门控。`isAutoMemoryEnabled()` 完整的优先级链 (env → SIMPLE → CCR → settings → default)、`getAutoMemPath()` 支持 env/settings/path 三级覆盖、`isExtractModeActive()` 提取门控、路径安全验证 |
| `memoryScan.ts` | **已实现** | 记忆目录扫描原语。`scanMemoryFiles()` 递归扫描 .md 文件并解析 frontmatter、`formatMemoryManifest()` 生成文本清单。单遍读取 + mtime 排序 |
| `findRelevantMemories.ts` | **已实现** | 相关性检索。通过 Sonnet 侧查询 (`sideQuery`) 从记忆文件中选择最相关的 5 条。包含工具过滤和 `MEMORY_SHAPE_TELEMETRY` 遥测 |
| `memoryAge.ts` | **已实现** | 记忆新鲜度工具。`memoryAgeDays()`, `memoryAge()`, `memoryFreshnessText()`, `memoryFreshnessNote()` |
| `teamMemPaths.ts` | **已实现** | 团队记忆路径与安全验证。`isTeamMemoryEnabled()`, `getTeamMemPath()`, `validateTeamMemWritePath()`, `validateTeamMemKey()` — 包含 symlink 解析和 path traversal 防护 |
| `teamMemPrompts.ts` | **已实现** | 团队记忆组合 prompt 构建器。`buildCombinedMemoryPrompt()` 同时输出 private + team 两套目录的指导 |
| `memoryShapeTelemetry.ts` | **部分实现** | 仅声明了类型签名，函数体为空 stub (`() => {}`)。需要实现实际的遥测逻辑 |

**依赖关系**: `paths.ts` 是基础，被所有其他模块依赖。`memoryTypes.ts` 提供纯常量。`memdir.ts` 依赖 `paths.ts` + `memoryTypes.ts`。`findRelevantMemories.ts` 依赖 `memoryScan.ts`。

**风险**:
- `memoryShapeTelemetry.ts` 是 stub，功能缺失但不影响核心行为
- GrowthBook feature flags (`tengu_passport_quail`, `tengu_moth_copse`, `tengu_herring_clock` 等) 是外部服务依赖，在非 Anthropic 环境下无法使用

---

### 2.2 后台记忆提取 — `src/services/extractMemories/` (2 文件, ~769 行)

| 文件 | 状态 | 说明 |
|------|------|------|
| `extractMemories.ts` | **已实现** | 完整的提取引擎。`initExtractMemories()` + `executeExtractMemories()` 模式。支持互斥 (主 agent 写了就跳过)、turn 节流、trailing run (stash-and-return)、forked agent (共享 prompt cache)、工具权限限制 (只读 + 记忆目录内写入)、5 turn 上限。通过 `feature('EXTRACT_MEMORIES')` 控制 |
| `prompts.ts` | **已实现** | 提取 prompt 模板。`buildExtractAutoOnlyPrompt()` 和 `buildExtractCombinedPrompt()` 两种变体，包含工具约束说明和现有记忆清单预注入 |

**依赖**: 依赖 `memdir/` (路径、扫描)、`utils/forkedAgent.ts` (fork 执行)、`utils/hooks/postSamplingHooks.ts` (hook 注册)。

**集成点**: 在 `src/query/stopHooks.ts` 的 `handleStopHooks()` 中，当 `feature('EXTRACT_MEMORIES')` + `isExtractModeActive()` 为真时，fire-and-forget 调用 `executeExtractMemories()`。

**风险**:
- `feature('EXTRACT_MEMORIES')` 不在当前 `scripts/defines.ts` 中定义，可能需要手动启用
- 提取依赖 GrowthBook flag `tengu_passport_quail`，外部构建无法获得此 flag

---

### 2.3 记忆合并/清理 — `src/services/autoDream/` (4 文件, ~552 行)

| 文件 | 状态 | 说明 |
|------|------|------|
| `autoDream.ts` | **已实现** | 自动合并引擎。`initAutoDream()` + `executeAutoDream()`。三级门控: 时间 (24h) → 会话数 (5) → 锁。使用 forked agent 执行，通过 `DreamTask` 注册 UI 可见任务 |
| `config.ts` | **已实现** | 配置读取。`isAutoDreamEnabled()` 检查 settings.json + GrowthBook `tengu_onyx_plover` |
| `consolidationLock.ts` | **已实现** | 基于 lock file 的并发控制。`tryAcquireConsolidationLock()`, `rollbackConsolidationLock()`, `readLastConsolidatedAt()` — PID 检查 + stale 超时 (1h) |
| `consolidationPrompt.ts` | **已实现** | 合并 prompt 模板。4 阶段结构: Orient → Gather → Consolidate → Prune |

**依赖**: 依赖 `extractMemories/` (共享 `createAutoMemCanUseTool`)、`DreamTask/`、`consolidationLock.ts`。

**集成点**: 在 `stopHooks.ts` 中与 extractMemories 并行 fire-and-forget 调用 `executeAutoDream()`。

**风险**: GrowthBook flag `tengu_onyx_plover` 是外部依赖。

---

### 2.4 团队记忆同步 — `src/services/teamMemorySync/` (4 文件, ~2167 行)

| 文件 | 状态 | 说明 |
|------|------|------|
| `index.ts` | **已实现** | 完整的同步服务。Pull (GET + ETag 缓存)、Push (delta + 冲突解决 + 分批上传)、Sync (双向)。`SyncState` 管理器。支持 secret scanning 预检 |
| `types.ts` | **已实现** | Zod schema + TypeScript 类型。`TeamMemoryDataSchema`, `TeamMemorySyncPushResult`, `TeamMemoryHashesResult` 等 |
| `watcher.ts` | **已实现** | 文件监听器。`fs.watch({recursive: true})` + 2s 防抖。启动时 pull → 持续 watch → shutdown flush。包含永久失败抑制逻辑 |
| `secretScanner.ts` | **已实现** | 客户端 secret 扫描。基于 gitleaks 规则子集 (30+ 规则)，覆盖 AWS/GCP/Azure/Anthropic/OpenAI/GitHub/Slack 等。支持 `scanForSecrets()` 和 `redactSecrets()` |
| `teamMemSecretGuard.ts` | **已实现** | 写入前检查门。被 FileWriteTool/FileEditTool 调用 |

**依赖**: 依赖 `memdir/teamMemPaths.ts` (路径验证)、OAuth (认证)、Anthropic API (同步端点)。通过 `feature('TEAMMEM')` 控制。

**风险**:
- 团队记忆同步依赖 Anthropic 第一方 OAuth 和 API 端点 (`/api/claude_code/team_memory`)，在非 Anthropic 环境完全不可用
- `feature('TEAMMEM')` 不在 `scripts/defines.ts` 中，是 Ant-internal only 的 feature

---

### 2.5 后台任务 UI — `src/tasks/DreamTask/` (1 文件, ~157 行)

| 文件 | 状态 | 说明 |
|------|------|------|
| `DreamTask.ts` | **已实现** | 任务注册 + 状态管理。`registerDreamTask()`, `addDreamTurn()`, `completeDreamTask()`, `failDreamTask()`。支持 footer pill 展示和 Shift+Down dialog |

**依赖**: 依赖 `services/autoDream/consolidationLock.ts` (kill 时回滚锁)、`utils/task/framework.ts` (任务注册)。

---

### 2.6 辅助工具函数

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/utils/memoryFileDetection.ts` | **已实现** | 全面的文件检测。`isAutoMemFile()`, `isAutoManagedMemoryFile()`, `isMemoryDirectory()`, `memoryScopeForPath()`, `isShellCommandTargetingMemory()` |
| `src/utils/teamMemoryOps.ts` | **已实现** | 团队记忆操作的摘要文本生成辅助 |
| `src/utils/memory/types.ts` | **已实现** | 记忆类型常量 (User/Project/Local/Managed/AutoMem/TeamMem) |
| `src/tools/AgentTool/agentMemory.ts` | **已实现** | Agent 持久化记忆。三 scope (user/project/local)，`loadAgentMemoryPrompt()` |
| `src/services/SessionMemory/sessionMemory.ts` | **已实现** | 会话级记忆（与 auto memory 不同体系）。独立的提取引擎，forked agent 更新 markdown 文件 |

---

### 2.7 CLI 命令 & 技能

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/commands/memory/index.ts` + `memory.tsx` | **已实现** | `/memory` 命令 — 打开 Dialog 让用户选择并编辑记忆文件 |
| `src/skills/bundled/dream.ts` | **已实现** | `/dream` 技能 — 手动触发记忆合并。交互式，完整权限 |
| `src/skills/bundled/remember.ts` | **已实现** | `/remember` 技能 — 审查 auto-memory 并提议提升到 CLAUDE.md/CLAUDE.local.md/team memory |

---

### 2.8 集成点分析

| 集成位置 | 说明 |
|----------|------|
| `src/QueryEngine.ts` | 在系统 prompt 构建时调用 `loadMemoryPrompt()` 注入记忆指令。当 SDK caller 设置了自定义 prompt + `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 时也会注入 |
| `src/query/stopHooks.ts` | 每轮对话结束时触发 `executeExtractMemories()` 和 `executeAutoDream()` (fire-and-forget) |
| `src/utils/attachments.ts` | 调用 `findRelevantMemories()` 将相关记忆文件以附件形式注入对话 |
| `src/utils/claudemd.ts` | `getMemoryFiles()` 发现并加载所有 MEMORY.md 文件到上下文 |
| `src/context.ts` | 调用 `getMemoryFiles()` + `getClaudeMds()` 构建完整指令上下文 |
| `src/tools/FileWriteTool/`, `src/tools/FileEditTool/` | 调用 `checkTeamMemSecrets()` 在写入团队记忆前检查敏感信息 |

---

## 三、功能门控汇总

| Feature Flag / 环境变量 | 作用 | 在 defines.ts 中? |
|-------------------------|------|-------------------|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 全局禁用 auto memory | N/A (环境变量) |
| `feature('EXTRACT_MEMORIES')` | 启用后台提取 | **否** |
| `feature('TEAMMEM')` | 启用团队记忆 | **否** |
| `feature('KAIROS')` | 助手模式 (日志而非索引) | **否** |
| `feature('MEMORY_SHAPE_TELEMETRY')` | 记忆遥测 | **否** |
| `tengu_passport_quail` (GrowthBook) | 提取 agent 开关 | 外部服务 |
| `tengu_moth_copse` (GrowthBook) | 附件模式 (跳过 MEMORY.md 索引) | 外部服务 |
| `tengu_herring_clock` (GrowthBook) | 团队记忆开关 | 外部服务 |
| `tengu_onyx_plover` (GrowthBook) | 自动合并开关 + 配置 | 外部服务 |
| `tengu_coral_fern` (GrowthBook) | 搜索过去上下文指导 | 外部服务 |
| `tengu_bramble_lintel` (GrowthBook) | 提取频率节流 | 外部服务 |

---

## 四、任务优先级排序

### P0 — 修复/验证 (阻塞正常使用)

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | 在 `scripts/defines.ts` 中添加 `EXTRACT_MEMORIES` feature flag | 当前 `feature('EXTRACT_MEMORIES')` 在 stopHooks.ts 中检查但未在 defines 中注册，提取 agent 永远不会触发。需添加到 dev 和 build 的默认 feature 列表中 | 无 |
| 2 | 验证 `loadMemoryPrompt()` 在系统 prompt 中的注入路径 | 确认在正常 REPL 模式下记忆指令确实被注入到系统 prompt。当前代码路径: `prompts.ts` → `context.ts` → `claudemd.ts getMemoryFiles()` | 无 |
| 3 | 编写 memdir 核心模块的单元测试 | 当前**零测试**覆盖。优先测试 `memoryTypes.ts` (纯函数)、`paths.ts` (路径解析/门控逻辑)、`memoryScan.ts` (扫描逻辑) | 无 |

### P1 — 增强 (改善功能质量)

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 4 | 实现 `memoryShapeTelemetry.ts` 的实际逻辑 | 当前是空 stub。需要实现 `logMemoryRecallShape()` 和 `logMemoryWriteShape()` | P0 #3 |
| 5 | 编写 extractMemories 单元测试 | 测试 `createAutoMemCanUseTool()` 权限逻辑、`hasMemoryWritesSince()` 检测、turn 节流、trailing run 逻辑 | P0 #3 |
| 6 | 编写 autoDream 单元测试 | 测试时间/会话/锁三级门控、lock file 并发控制、rollback 逻辑 | P0 #3 |
| 7 | 编写 findRelevantMemories 单元测试 | 测试 Sonnet 侧查询的 mock、空结果、alreadySurfaced 过滤 | P0 #3 |
| 8 | 添加 `TEAMMEM` feature flag 到 defines.ts (可选) | 团队记忆功能依赖 Anthropic OAuth + API，在非 Anthropic 构建中无意义。如需测试需添加 | P0 #1 |

### P2 — 优化 (非阻塞)

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 9 | 编写 teamMemorySync 单元测试 | 测试 delta 计算、冲突解决、secret scanning、batch 分割 | P1 #5 |
| 10 | 编写 memoryFileDetection 单元测试 | 测试路径检测、scope 分类、shell 命令解析 | P0 #3 |
| 11 | 编写 DreamTask 单元测试 | 测试任务注册、状态更新、kill 回滚 | P1 #6 |
| 12 | 审查 GrowthBook feature flags 的降级行为 | 确认所有 GrowthBook flags 在无网络/缓存未命中时的合理默认值 | 无 |
| 13 | 添加记忆相关集成测试 | 端到端测试: 系统构建 → 对话 → 提取 → 合并 → 下轮注入 | P0 #3, P1 #5-7 |

---

## 五、风险和难点

### 5.1 高风险

1. **Feature flag 缺失导致功能静默失效**: `EXTRACT_MEMORIES` 未在 `scripts/defines.ts` 中定义，`feature('EXTRACT_MEMORIES')` 始终返回 `false`，后台提取永远不会运行。这是最关键的发现。

2. **GrowthBook 外部依赖**: 大量核心功能 (提取、附件模式、团队记忆、自动合并) 都通过 GrowthBook feature flags 控制。在非 Anthropic 内部环境中，这些 flags 的缓存默认值决定功能是否可用。当前代码中大部分 GrowthBook 调用的默认值为 `false`，意味着外部用户无法获得这些功能。

3. **零测试覆盖**: 记忆系统是代码库中最复杂的子系统之一 (24 文件, ~6330 行)，但没有任何单元测试。任何重构或修改都有引入回归的风险。

### 5.2 中风险

4. **团队记忆同步的 API 依赖**: `teamMemorySync/` 完全依赖 Anthropic 第一方 OAuth 和内部 API 端点。在非 Anthropic 环境中这些功能不可用，但代码通过 `feature('TEAMMEM')` 正确隔离，不会造成运行时错误。

5. **并发安全**: `extractMemories` 和 `autoDream` 都使用 closure-scoped 状态 + fire-and-forget 模式。`consolidationLock` 使用 PID 检查 + stale 超时。在极端情况下 (进程崩溃、系统休眠) 可能出现锁残留，但代码已有回滚和过期机制处理这种情况。

6. **KAIROS 模式的日志轮转**: 当 `feature('KAIROS')` 启用时，记忆写入改为 append-only 日志模式，依赖 `/dream` 技能进行定期蒸馏。如果 dream 不运行，日志会无限增长。

### 5.3 低风险

7. **MEMORY.md 截断边界**: 200 行 / 25KB 的截断上限是硬性的，超出部分静默丢弃并追加警告。极端情况下用户可能丢失索引条目。

8. **secret scanner 误报/漏报**: 基于 gitleaks 规则子集的客户端扫描可能产生误报 (阻止合法写入) 或漏报 (允许 secret 泄露到团队记忆)。

---

## 六、文件清单

### 核心实现文件 (全部已实现)

```
src/memdir/
  memdir.ts              (507 行) — 主入口, prompt 构建, 截断, 目录保障
  memoryTypes.ts         (271 行) — 四类型分类法, prompt 段落常量
  paths.ts               (278 行) — 路径解析, 门控, 安全验证
  memoryScan.ts          (94 行)  — 目录扫描, frontmatter 解析
  findRelevantMemories.ts(141 行) — Sonnet 侧查询相关性选择
  memoryAge.ts           (53 行)  — 新鲜度工具函数
  teamMemPaths.ts        (293 行) — 团队记忆路径 + symlink 安全
  teamMemPrompts.ts      (100 行) — 组合 prompt 构建器
  memoryShapeTelemetry.ts(7 行)   — STUB — 遥测 (未实现)

src/services/extractMemories/
  extractMemories.ts     (616 行) — 后台提取引擎
  prompts.ts             (154 行) — 提取 prompt 模板

src/services/autoDream/
  autoDream.ts           (326 行) — 自动合并引擎
  config.ts              (21 行)  — 合并配置读取
  consolidationLock.ts   (140 行) — 并发锁控制
  consolidationPrompt.ts (65 行)  — 合并 prompt 模板

src/services/teamMemorySync/
  index.ts               (1256 行)— 完整同步服务
  types.ts               (157 行) — Zod schema + 类型
  watcher.ts             (388 行) — 文件监听 + 防抖推送
  secretScanner.ts       (325 行) — 客户端 secret 扫描
  teamMemSecretGuard.ts  (44 行)  — 写入前检查门

src/tasks/DreamTask/
  DreamTask.ts           (157 行) — 后台任务 UI 注册

src/utils/memoryFileDetection.ts (290 行) — 文件检测
src/utils/teamMemoryOps.ts       (89 行)  — 操作辅助
src/utils/memory/types.ts        (12 行)  — 类型常量

src/tools/AgentTool/agentMemory.ts       (178 行) — Agent 持久化记忆
src/services/SessionMemory/sessionMemory.ts (496 行) — 会话级记忆

src/commands/memory/index.ts + memory.tsx (103 行) — /memory CLI 命令
src/skills/bundled/dream.ts              (44 行)  — /dream 技能
src/skills/bundled/remember.ts           (83 行)  — /remember 技能
```

### 需要新建的测试文件

```
src/memdir/__tests__/memoryTypes.test.ts
src/memdir/__tests__/paths.test.ts
src/memdir/__tests__/memoryScan.test.ts
src/memdir/__tests__/findRelevantMemories.test.ts
src/memdir/__tests__/memoryAge.test.ts
src/memdir/__tests__/memdir.test.ts
src/services/extractMemories/__tests__/extractMemories.test.ts
src/services/extractMemories/__tests__/prompts.test.ts
src/services/autoDream/__tests__/autoDream.test.ts
src/services/autoDream/__tests__/consolidationLock.test.ts
src/tasks/DreamTask/__tests__/DreamTask.test.ts
src/utils/__tests__/memoryFileDetection.test.ts
```

---

## 七、建议的实施顺序

1. **第一步**: 在 `scripts/defines.ts` 中添加 `EXTRACT_MEMORIES` 到 dev 和 build 的默认 feature 列表
2. **第二步**: 验证 REPL 模式下 `loadMemoryPrompt()` 确实注入到系统 prompt
3. **第三步**: 为 `memdir/` 核心模块编写单元测试 (优先 `memoryTypes.ts`, `paths.ts`, `memoryScan.ts`)
4. **第四步**: 实现 `memoryShapeTelemetry.ts` 的真实逻辑
5. **第五步**: 为 `extractMemories/` 和 `autoDream/` 编写测试
6. **第六步**: 按需添加 `TEAMMEM` feature flag (仅当需要团队记忆测试时)
7. **第七步**: 端到端集成测试
