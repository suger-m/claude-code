# Swarm / 多Agent 协调功能 - 实施计划

> 基于 `design.md` 和代码库实际调查
> 创建日期: 2026-04-05

## 一、总体概述

Swarm 功能允许 Claude Code 创建多个 Agent 组成的团队，以并行或协作方式完成任务。当前代码库中已有**大量且功能完整的实现**，分布在 `src/utils/swarm/`、`src/tasks/`、`src/tools/`、`src/components/` 等多个位置，总计约 15,000+ 行代码。

**关键发现：该功能已基本可用，但分散在 `src/` 下多个子目录中，设计文档要求统一到 `packages/swarm/`。**

---

## 二、模块清单与当前状态

### 2.1 核心编排层

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/agentSwarmsEnabled.ts` | 44 | **已实现** | Swarm 功能总开关（三层门控：USER_TYPE=ant / 环境变量+CLI flag / GrowthBook killswitch） |
| `src/utils/swarm/constants.ts` | 34 | **已实现** | 常量定义（session名、环境变量名等） |
| `src/utils/swarm/teamHelpers.ts` | 684 | **已实现** | 团队文件管理（CRUD、成员管理、权限模式同步、worktree 清理、session 清理） |
| `src/utils/swarm/teammateModel.ts` | 11 | **已实现** | 队友默认模型选择（Opus 4.6，provider-aware） |
| `src/utils/swarm/teammatePromptAddendum.ts` | 19 | **已实现** | 队友系统提示追加（通信指引） |
| `src/utils/swarm/leaderPermissionBridge.ts` | 50 | **已实现** | Leader 端权限桥接（让 in-process 队友复用 Leader 的 ToolUseConfirm 队列） |

### 2.2 后端执行层

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/swarm/backends/types.ts` | 311 | **已实现** | 完整类型系统：`PaneBackend`、`TeammateExecutor`、`TeammateSpawnConfig`/`Result`、`TeammateMessage`、`TeammateIdentity` 等 |
| `src/utils/swarm/backends/registry.ts` | 464 | **已实现** | 后端注册表与自动检测（优先级：tmux inside > iTerm2+it2 > tmux external > in-process fallback） |
| `src/utils/swarm/backends/detection.ts` | — | **已实现** | 环境检测（tmux/iTerm2/it2 CLI） |
| `src/utils/swarm/backends/InProcessBackend.ts` | 340 | **已实现** | 进程内后端（AsyncLocalStorage 隔离，共享 API 客户端） |
| `src/utils/swarm/backends/TmuxBackend.ts` | 765 | **已实现** | Tmux 后端（内/外 tmux 两种模式，pane 创建/管理/着色/隐藏/显示） |
| `src/utils/swarm/backends/ITermBackend.ts` | 371 | **已实现** | iTerm2 后端（it2 CLI 分屏，dead-session 自动恢复） |
| `src/utils/swarm/backends/PaneBackendExecutor.ts` | 355 | **已实现** | PaneBackend 适配器，统一到 `TeammateExecutor` 接口 |
| `src/utils/swarm/backends/teammateModeSnapshot.ts` | 87 | **已实现** | 会话启动时捕获 teammate mode（auto/tmux/in-process） |
| `src/utils/swarm/backends/it2Setup.ts` | — | **已实现** | it2 CLI 安装/设置引导 |

### 2.3 进程内队友执行

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/swarm/spawnInProcess.ts` | 329 | **已实现** | In-process 队友创建（TeammateContext、AbortController、AppState 注册、清理） |
| `src/utils/swarm/inProcessRunner.ts` | 1553 | **已实现** | **核心模块**。完整的 in-process 队友执行循环：runAgent 封装、权限处理（桥接 Leader UI + mailbox fallback）、mailbox 轮询、compaction、idle notification、shutdown 流程、任务列表自动认领 |

### 2.4 权限同步系统

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/swarm/permissionSync.ts` | 929 | **已实现** | **大模块**。完整的权限同步：文件系统 + mailbox 双通道、请求/响应生命周期、sandbox 权限、lockfile 并发控制、自动清理 |
| `src/hooks/toolPermission/handlers/swarmWorkerHandler.ts` | 160 | **已实现** | Worker 端权限处理入口（classifier 自审批 → mailbox 转发 Leader → 回调等待） |
| `src/hooks/useSwarmPermissionPoller.ts` | — | **已实现** | Leader 端轮询 worker 权限请求 |
| `src/hooks/useSwarmInitialization.ts` | — | **已实现** | Swarm 初始化 hook |
| `src/hooks/useInboxPoller.ts` | — | **已实现** | Inbox 消息轮询 |

### 2.5 任务系统

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/tasks/InProcessTeammateTask/types.ts` | 121 | **已实现** | In-process 队友状态类型（含消息上限 50 条，防止内存膨胀） |
| `src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx` | 156 | **已实现** | Task 接口实现（kill、shutdown request、消息注入） |
| `src/tasks/LocalMainSessionTask.ts` | 481 | **已实现** | 主会话任务（非 swarm 专用，但 swarm 依赖其任务框架） |
| `src/tasks/LocalAgentTask/LocalAgentTask.tsx` | 804 | **已实现** | 本地 Agent 任务（progress tracking 等被 inProcessRunner 复用） |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | 1102 | **已实现** | 远程 Agent 任务 |
| `src/tasks/types.ts` | — | **已实现** | 任务通用类型 |
| `src/tasks/stopTask.ts` | — | **已实现** | 停止任务工具函数 |

### 2.6 通信系统

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/teammateMailbox.ts` | 1187 | **已实现** | **大模块**。完整的文件邮箱系统：读写/标记已读、lockfile 并发控制、消息格式化（shutdown request/response、permission request/response、idle notification） |
| `src/tools/SendMessageTool/SendMessageTool.ts` | 917 | **已实现** | 发送消息工具（peer-to-peer、广播、带颜色/摘要） |
| `src/utils/swarm/spawnUtils.ts` | 147 | **已实现** | 队友 spawn 工具函数（命令构建、CLI flags 继承、环境变量转发） |

### 2.7 Worktree 管理

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/utils/worktree.ts` | 1519 | **已实现** | Git worktree 完整管理（创建/删除/验证/slug 安全性、hook 执行） |
| `src/utils/worktreeModeEnabled.ts` | — | **已实现** | Worktree 模式开关 |

### 2.8 工具层

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/tools/TeamCreateTool/TeamCreateTool.ts` | 240 | **已实现** | 创建团队工具 |
| `src/tools/TeamDeleteTool/TeamDeleteTool.ts` | 139 | **已实现** | 删除团队工具 |
| `src/tools/TaskCreateTool/TaskCreateTool.ts` | — | **已实现** | 创建任务工具（任务列表供队友认领） |

### 2.9 UI 层

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `src/components/teams/TeamsDialog.tsx` | 818 | **已实现** | 团队管理对话框（成员列表、权限模式切换、hide/show、终止） |
| `src/components/tasks/InProcessTeammateDetailDialog.tsx` | 193 | **已实现** | In-process 队友详情对话框（transcript 查看） |
| `src/utils/swarm/It2SetupPrompt.tsx` | 377 | **已实现** | it2 CLI 安装引导 UI |
| `src/utils/swarm/teammateLayoutManager.ts` | ~50 | **已实现** | 颜色分配管理 |
| `src/utils/swarm/teammateInit.ts` | ~100 | **已实现** | 队友初始化（Stop hook、team allowed paths 应用） |
| `src/utils/swarm/reconnection.ts` | ~50 | **已实现** | 断线重连（从 transcript 恢复 teamContext） |

### 2.10 测试覆盖

| 状态 | 说明 |
|------|------|
| **未实现** | swarm 相关代码目前无任何测试文件（`__tests__/` 目录下无 swarm/team/teammate 相关测试） |

---

## 三、当前架构 vs 设计目标对比

### 设计文档要求
- 统一到 `packages/swarm/`
- 包含 `SwarmOrchestrator` 类（spawnTeammate、broadcast、getTeamStatus、shutdown）
- Task 类型系统（13 个入口）
- Worktree 管理

### 当前实际情况
- 代码分散在 `src/utils/swarm/`（22 文件，7546 行）、`src/tasks/`、`src/tools/`、`src/components/`、`src/hooks/`
- **没有** `SwarmOrchestrator` 类——功能通过多个独立模块和 `TeamCreateTool` 分散实现
- `TeammateExecutor` 接口已统一了 spawn/sendMessage/terminate/kill/isActive
- 任务系统完整但不是设计文档描述的 13 入口结构
- Worktree 管理独立于 swarm 目录，在 `src/utils/worktree.ts`

---

## 四、任务计划（按优先级排序）

### P0: 验证与稳定化（当前功能已存在，需确保可靠）

#### 4.1 添加 Swarm 模块测试
- **状态**: 未实现
- **工作量**: 3-5 天
- **具体工作**:
  - `src/utils/swarm/__tests__/teamHelpers.test.ts` — 团队文件 CRUD、成员管理、权限同步
  - `src/utils/swarm/__tests__/permissionSync.test.ts` — 权限请求/响应生命周期、并发控制
  - `src/utils/swarm/__tests__/spawnInProcess.test.ts` — 队友创建、AbortController 联动
  - `src/utils/swarm/__tests__/inProcessRunner.test.ts` — 执行循环、idle notification、shutdown 流程
  - `src/utils/swarm/__tests__/backends/registry.test.ts` — 后端检测优先级、缓存、fallback
  - `src/utils/teammateMailbox/__tests__/teammateMailbox.test.ts` — 邮箱读写、lockfile 并发
- **依赖**: 无外部依赖
- **风险**: 模块间耦合较重，mock 策略需要仔细设计（特别是 `ToolUseContext`、`AppState`、`AsyncLocalStorage`）

#### 4.2 补充集成测试
- **状态**: 未实现
- **工作量**: 2-3 天
- **具体工作**:
  - `tests/integration/swarm-team-lifecycle.ts` — 团队创建 → spawn 队友 → 发消息 → shutdown → 清理
  - `tests/integration/swarm-permission-flow.ts` — Worker 权限请求 → Leader 审批 → Worker 继续
  - `tests/integration/swarm-multi-backend.ts` — 验证不同 backend 的 spawn 行为一致性
- **依赖**: P0.1 完成
- **风险**: 需要 mock 终端环境（tmux/iTerm2 检测）

### P1: 代码整理（非功能变更）

#### 4.3 考虑是否迁移到 `packages/swarm/`
- **状态**: 待评估
- **工作量**: 5-8 天（如果决定迁移）
- **具体工作**:
  - 评估迁移收益：代码集中 vs import 路径变更的影响范围
  - 如果迁移：将 `src/utils/swarm/` → `packages/swarm/src/`
  - 更新所有 import 路径（涉及 50+ 文件）
  - 调整 `package.json` workspace 配置
  - 确保构建流程（`build.ts`）正确处理新 package
- **依赖**: P0 完成
- **风险**: 大规模 import 重构可能引入回归；与 `src/` 内部模块（`Task`、`AppState`、`Tool`）的循环依赖需要解决
- **建议**: **暂不迁移**。当前代码虽分散但功能完整，迁移的 ROI 不高。可以在未来代码重构时自然收敛。

#### 4.4 统一 `SwarmOrchestrator` 入口
- **状态**: 未实现（功能分散在多个模块中）
- **工作量**: 3-4 天
- **具体工作**:
  - 创建 `src/utils/swarm/orchestrator.ts`，聚合现有功能：
    - `spawnTeammate()` → 调用 `getTeammateExecutor().spawn()`
    - `broadcast()` → 调用 `writeToMailbox()` 对所有成员
    - `getTeamStatus()` → 调用 `readTeamFile()` + 检查各队友 `isActive()`
    - `shutdown()` → 调用各队友 `terminate()` + `cleanupTeamDirectories()`
  - 现有代码（`TeamCreateTool`、`TeamsDialog`）改为通过 orchestrator 调用
- **依赖**: P0.1（需要测试覆盖保障重构）
- **风险**: 中等——需要确保所有调用点正确迁移

### P2: 功能增强

#### 4.5 改进错误处理与恢复
- **状态**: 部分实现（有基础的 logForDebugging 和 try/catch）
- **工作量**: 2-3 天
- **具体工作**:
  - 队友 crash 时的自动检测与通知（目前依赖 idle notification，crash 时可能丢失）
  - Leader 异常退出时的队友孤儿检测（`cleanupSessionTeams` 已有基础，但 killOrphanedTeammatePanes 是异步的，可能不完整）
  - 文件邮箱的损坏恢复（json parse 失败时的降级处理）
  - 网络断连时的重试策略
- **依赖**: P0
- **风险**: 低

#### 4.6 性能优化
- **状态**: 部分实现（已有消息上限 `TEAMMATE_MESSAGES_UI_CAP = 50`、compaction）
- **工作量**: 3-5 天
- **具体工作**:
  - 邮箱轮询频率优化（当前 500ms 固定间隔，可改为指数退避或 inotify/fsevents）
  - 权限请求文件系统的性能（高频场景下 lockfile 竞争）
  - 大团队（10+ 队友）下的资源使用监控
  - in-process 队友的内存限制（已有 compaction，但可能需要更激进策略）
- **依赖**: P0
- **风险**: 中等——性能优化需要基准测试数据支撑

#### 4.7 后端健壮性提升
- **状态**: 基本可用但有局限
- **工作量**: 2-3 天
- **具体工作**:
  - **iTerm2**: `hidePane`/`showPane` 未实现（当前为 stub）
  - **iTerm2**: pane 边框着色和标题设置被跳过（性能原因，每个 it2 调用需要启动 Python 进程）
  - **Tmux**: pane 创建锁可能导致长时间阻塞
  - **In-process**: `isActive()` 实现过于简单（依赖 spawnedTeammates Map 而非实际状态检查）
- **依赖**: P0
- **风险**: 低

### P3: 扩展功能

#### 4.8 Coordinator Mode / 工作流编排
- **状态**: 部分实现（`src/components/tasks/src/coordinator/coordinatorMode.ts` 存在）
- **工作量**: 5-8 天
- **具体工作**:
  - 研究 `coordinatorMode.ts` 的当前实现程度
  - 实现基于 DAG 的工作流编排（任务依赖、并行执行、失败重试）
  - 添加工作流定义 schema
- **依赖**: P0, P1
- **风险**: 高——需要设计决策和充分测试

#### 4.9 远程 Agent 支持
- **状态**: `RemoteAgentTask` 文件存在（1102 行）
- **工作量**: 取决于远程基础设施
- **具体工作**:
  - 调查 `RemoteAgentTask` 的当前实现状态
  - SSH 远程 spawn
  - 远程权限同步
- **依赖**: P0, P1
- **风险**: 高——依赖外部基础设施

---

## 五、依赖关系图

```
P0.1 添加单元测试 ─────────────┐
P0.2 补充集成测试 ← P0.1      │
                                ├→ P1.3 统一 Orchestrator
                                ├→ P1.4 考虑迁移 packages/swarm
                                │
                                ├→ P2.5 改进错误处理
                                ├→ P2.6 性能优化
                                ├→ P2.7 后端健壮性
                                │
                                └→ P3.8 工作流编排
                                   P3.9 远程 Agent 支持
```

---

## 六、风险评估

### 高风险
1. **内存消耗**: 设计文档提到 "292 agents in 2 minutes reached 36.8GB"。当前已有 `TEAMMATE_MESSAGES_UI_CAP` 和 compaction 缓解，但大量并发 Agent 仍可能导致 OOM。
2. **文件系统并发**: 邮箱和权限系统依赖 lockfile，在大量并发场景下可能出现性能瓶颈或死锁。
3. **后端差异**: Tmux/iTerm2/In-process 三个后端的行为一致性问题——特别是权限流程、消息传递、shutdown 处理。

### 中风险
1. **代码分散**: Swarm 功能涉及 30+ 个文件，分布在 6 个不同目录，增加维护和调试难度。
2. **无测试覆盖**: 当前零测试，任何重构或功能变更都没有安全网。
3. **iTerm2 后端局限**: hide/show 不支持，pane 着色/标题被跳过，用户体验不一致。

### 低风险
1. **API 变更**: Anthropic API 变更可能影响多 Agent 并发请求（rate limit）。
2. **终端兼容性**: 不同终端模拟器的行为差异（颜色、分屏、输入处理）。

---

## 七、实施建议

### 短期（1-2 周）
1. 完成 P0.1 单元测试（覆盖核心模块 `teamHelpers`、`permissionSync`、`spawnInProcess`、`inProcessRunner`）
2. 完成 P0.2 集成测试

### 中期（2-4 周）
3. 完成 P1.4 统一 Orchestrator 入口（提高代码可维护性）
4. 完成 P2.5 错误处理改进

### 长期
5. 根据用户反馈决定是否迁移到 `packages/swarm/`
6. 评估 P2.6 性能优化需求（需要实际使用数据）
7. P3.8/P3.9 按需实现

---

## 八、关键文件索引

### 核心代码（已实现）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/inProcessRunner.ts` — 队友执行循环（1553 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/permissionSync.ts` — 权限同步（929 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/teammateMailbox.ts` — 文件邮箱系统（1187 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/teamHelpers.ts` — 团队文件管理（684 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/TmuxBackend.ts` — Tmux 后端（765 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/registry.ts` — 后端注册/检测（464 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/types.ts` — 类型系统（311 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/InProcessBackend.ts` — In-process 后端（340 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/ITermBackend.ts` — iTerm2 后端（371 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts` — Pane 适配器（355 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/spawnInProcess.ts` — 队友创建（329 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/worktree.ts` — Worktree 管理（1519 行）

### UI 组件（已实现）
- `/Users/konghayao/code/ai/claude-code/src/components/teams/TeamsDialog.tsx` — 团队管理对话框（818 行）
- `/Users/konghayao/code/ai/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx` — 队友详情（193 行）
- `/Users/konghayao/code/ai/claude-code/src/utils/swarm/It2SetupPrompt.tsx` — it2 设置引导（377 行）

### 工具（已实现）
- `/Users/konghayao/code/ai/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts` — 创建团队
- `/Users/konghayao/code/ai/claude-code/src/tools/TeamDeleteTool/TeamDeleteTool.ts` — 删除团队
- `/Users/konghayao/code/ai/claude-code/src/tools/SendMessageTool/SendMessageTool.ts` — 发送消息

### 任务系统（已实现）
- `/Users/konghayao/code/ai/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`
- `/Users/konghayao/code/ai/claude-code/src/tasks/InProcessTeammateTask/types.ts`
- `/Users/konghayao/code/ai/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `/Users/konghayao/code/ai/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`

### 权限相关（已实现）
- `/Users/konghayao/code/ai/claude-code/src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`
- `/Users/konghayao/code/ai/claude-code/src/hooks/useSwarmPermissionPoller.ts`
- `/Users/konghayao/code/ai/claude-code/src/hooks/useSwarmInitialization.ts`
- `/Users/konghayao/code/ai/claude-code/src/hooks/useInboxPoller.ts`

### 功能开关
- `/Users/konghayao/code/ai/claude-code/src/utils/agentSwarmsEnabled.ts` — 总开关（三层门控）
