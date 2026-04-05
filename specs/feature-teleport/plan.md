# Teleport 功能重构实施计划

> 基于 `design.md` 和代码库现状调查，目标是将分散在 `src/utils/`、`src/remote/`、`src/hooks/`、`src/components/` 中的 teleport 相关代码提取为独立 `packages/teleport` 包。

## 一、现状总览

### 代码规模统计

当前 teleport 相关代码约 **5502 行**，分布在 **19 个核心文件**中：

| 文件路径 | 行数 | 职责 |
|---------|------|------|
| `src/utils/teleport.tsx` | 1518 | 核心逻辑：创建远程会话、恢复会话、Git 分支操作、轮询事件 |
| `src/utils/teleport/api.ts` | 466 | API 客户端：Sessions API、OAuth 请求、重试逻辑 |
| `src/utils/teleport/environments.ts` | 120 | 环境获取：fetchEnvironments、createDefaultCloudEnvironment |
| `src/utils/teleport/environmentSelection.ts` | 77 | 环境选择逻辑：读取配置、匹配默认环境 |
| `src/utils/teleport/gitBundle.ts` | 293 | Git Bundle：打包、上传、降级策略（--all -> HEAD -> squashed） |
| `src/remote/RemoteSessionManager.ts` | 344 | 远程会话管理：WS 连接、权限请求、消息收发 |
| `src/remote/SessionsWebSocket.ts` | 404 | WebSocket 连接层：认证、重连、心跳 |
| `src/remote/remotePermissionBridge.ts` | 78 | 权限桥接：创建合成 AssistantMessage/Tool Stub |
| `src/remote/sdkMessageAdapter.ts` | 306 | 消息适配器：SDK Message -> REPL Message 转换 |
| `src/hooks/useRemoteSession.ts` | 607 | React Hook：远程会话生命周期管理、UI 状态 |
| `src/hooks/useTeleportResume.tsx` | 78 | React Hook：teleport 恢复会话 |
| `src/components/TeleportProgress.tsx` | 122 | UI 组件：进度展示 |
| `src/components/TeleportError.tsx` | 159 | UI 组件：前置条件检查与错误处理 |
| `src/components/TeleportStash.tsx` | 148 | UI 组件：Git Stash 操作对话框 |
| `src/components/TeleportResumeWrapper.tsx` | 108 | UI 组件：会话恢复流程容器 |
| `src/components/TeleportRepoMismatchDialog.tsx` | 104 | UI 组件：仓库不匹配对话框 |
| `src/components/RemoteEnvironmentDialog.tsx` | 237 | UI 组件：环境选择对话框 |
| `src/utils/background/remote/preconditions.ts` | 235 | 前置条件检查：登录、Git 状态、GitHub App |
| `src/utils/background/remote/remoteSession.ts` | 98 | 后台远程会话类型与资格检查 |

另有约 **33 个文件**引用 teleport 相关模块（含 `main.tsx`、REPL、AgentTool、ultraplan 等）。

### 当前 `src/utils/teleport/src/` 目录

存在 3 个存根文件（`oauth.ts`、`analytics/index.ts`、`oauth/client.ts`），均为 `any` 类型占位，是提取过程中的中间产物，需在正式提取时替换为实际实现。

### 测试现状

目前 **没有任何 teleport 专属的测试文件**。这是一个重大风险点。

---

## 二、目标架构

```
packages/teleport/
  package.json
  tsconfig.json
  src/
    index.ts                          # 公开 API 汇总导出
    api/
      sessions.ts                     # Sessions API 客户端 (来自 api.ts)
      environments.ts                 # 环境获取与管理 (来自 environments.ts)
      environmentSelection.ts         # 环境选择逻辑 (来自 environmentSelection.ts)
      sessionIngress.ts               # Session Ingress 日志上传 (来自 sessionIngress.ts 相关部分)
    git/
      bundle.ts                       # Git Bundle 打包上传 (来自 gitBundle.ts)
      branchOps.ts                    # Git 分支操作 (来自 teleport.tsx 中的分支函数)
      repositoryValidation.ts         # 仓库验证 (来自 teleport.tsx 中的验证函数)
    session/
      createSession.ts                # 创建远程会话 (来自 teleport.tsx teleportToRemote)
      resumeSession.ts                # 恢复远程会话 (来自 teleport.tsx teleportResumeCodeSession)
      pollEvents.ts                   # 轮询会话事件 (来自 teleport.tsx pollRemoteSessionEvents)
      archiveSession.ts               # 归档会话 (来自 teleport.tsx archiveRemoteSession)
    remote/
      RemoteSessionManager.ts         # 远程会话管理器 (来自 remote/)
      SessionsWebSocket.ts            # WebSocket 连接 (来自 remote/)
      sdkMessageAdapter.ts            # SDK 消息适配 (来自 remote/)
      remotePermissionBridge.ts       # 权限桥接 (来自 remote/)
    preconditions/
      index.ts                        # 前置条件检查汇总 (来自 background/remote/)
    types.ts                          # 共享类型定义
    errors.ts                         # TeleportOperationError 等
    __tests__/
      api.test.ts
      git-bundle.test.ts
      session-lifecycle.test.ts
      preconditions.test.ts
```

**保留在 `src/` 中的部分**（UI/React 层，不提取到 package）：

- `src/hooks/useRemoteSession.ts` — 依赖 Ink/React/AppState，属于 UI 层
- `src/hooks/useTeleportResume.tsx` — 同上
- `src/components/Teleport*.tsx` — UI 组件，依赖 Ink/React/Dialog
- `src/components/RemoteEnvironmentDialog.tsx` — UI 组件
- `src/dialogLaunchers.tsx` 中的 teleport launcher — UI 入口

---

## 三、模块详细分析

### 模块 1：API 客户端层

**文件**：`src/utils/teleport/api.ts`（466 行）

**当前状态**：已实现

**功能清单**：
- `prepareApiRequest()` — OAuth 认证准备
- `fetchCodeSessionsFromSessionsAPI()` — 获取会话列表
- `fetchSession()` — 获取单个会话
- `sendEventToRemoteSession()` — 向远程会话发送消息
- `updateSessionTitle()` — 更新会话标题
- `getBranchFromSession()` — 提取分支信息
- `axiosGetWithRetry()` — 带重试的 HTTP GET
- 类型定义：`SessionResource`, `CodeSession`, `SessionContext`, `GitSource` 等

**提取工作**：
- 将 `getOauthConfig`、`getClaudeAIOAuthTokens`、`getOrganizationUUID` 等外部依赖改为通过接口/参数注入
- 保留核心 HTTP 逻辑和类型定义
- 拆分为 `api/sessions.ts`

**依赖关系**：
- 外部：`axios`, `crypto`, `zod`
- 内部（需抽象）：`src/constants/oauth.js`, `src/services/oauth/client.js`, `src/utils/auth.js`, `src/utils/errors.js`
- 无其他模块依赖

---

### 模块 2：环境管理

**文件**：`src/utils/teleport/environments.ts`（120 行）、`src/utils/teleport/environmentSelection.ts`（77 行）

**当前状态**：已实现

**功能清单**：
- `fetchEnvironments()` — 获取可用远程环境列表
- `createDefaultCloudEnvironment()` — 创建默认云环境
- `getEnvironmentSelectionInfo()` — 获取当前环境选择状态

**提取工作**：
- 将 `getSettings_DEPRECATED` 依赖改为通过参数/接口注入
- 合并为 `api/environments.ts` + `api/environmentSelection.ts`

**依赖关系**：
- 依赖模块 1（`api.ts` 中的 `getOAuthHeaders`）
- 外部：`src/utils/settings/`

---

### 模块 3：Git Bundle 打包

**文件**：`src/utils/teleport/gitBundle.ts`（293 行）

**当前状态**：已实现

**功能清单**：
- `createAndUploadGitBundle()` — 创建并上传 Git Bundle
- `_bundleWithFallback()` — 降级策略（--all -> HEAD -> squashed-root）

**提取工作**：
- 将 `uploadFile`、`getFeatureValue_CACHED_MAY_BE_STALE` 依赖注入
- 较为独立，依赖最少

**依赖关系**：
- 外部：`fs/promises`, `src/services/api/filesApi.js`
- 内部：`src/utils/git.js`, `src/utils/tempfile.js`, `src/services/analytics/`

---

### 模块 4：核心会话逻辑（teleport.tsx 主体）

**文件**：`src/utils/teleport.tsx`（1518 行）

**当前状态**：已实现，是最大的单文件

**功能清单**：
- `teleportToRemote()` — 创建远程会话（~470 行，最复杂）
  - GitHub 源选择（preflight check）
  - Bundle 降级
  - 环境选择
  - API 请求构造
- `teleportResumeCodeSession()` — 恢复会话
- `teleportFromSessionsAPI()` — 从 Sessions API 获取会话数据
- `pollRemoteSessionEvents()` — 轮询远程事件
- `archiveRemoteSession()` — 归档会话
- `validateGitState()` — Git 状态验证
- `validateSessionRepository()` — 仓库匹配验证
- `checkOutTeleportedSessionBranch()` — 分支切换
- `generateTitleAndBranch()` — 使用 Haiku 生成标题和分支名
- `processMessagesForTeleportResume()` — 消息处理

**提取工作**：
- 按职责拆分为多个文件（见目标架构）
- 将 `queryHaiku` 依赖抽象为接口（LLM 调用）
- 将 `chalk` 渲染逻辑移除或参数化（package 层不应直接渲染）
- 将 React 组件渲染（`TeleportError` 的 JSX）从 `handleTeleportPrerequisites` 中分离

**依赖关系**：
- 依赖模块 1、2、3
- 外部大量依赖：`queryHaiku`, `detectRepository`, `git.js`, `messages.js`, `auth.js`, `conversationRecovery.js`, `sessionIngress.js`, `settings.js`
- 被依赖方：`main.tsx`, `AgentTool`, `REPL.tsx`, `TeleportProgress.tsx` 等

---

### 模块 5：远程连接层

**文件**：`src/remote/RemoteSessionManager.ts`（344 行）、`SessionsWebSocket.ts`（404 行）、`remotePermissionBridge.ts`（78 行）、`sdkMessageAdapter.ts`（306 行）

**当前状态**：已实现

**功能清单**：
- `RemoteSessionManager` — 协调 WS 订阅、HTTP POST 消息、权限请求/响应
- `SessionsWebSocket` — WS 连接管理、认证、重连、心跳、控制消息
- `createSyntheticAssistantMessage` / `createToolStub` — 权限桥接
- `convertSDKMessage` — SDK Message -> REPL Message 适配

**提取工作**：
- `SessionsWebSocket` 直接依赖 `ws` 库和 `getWebSocketTLSOptions`、`getWebSocketProxyAgent`，需抽象网络层
- `sdkMessageAdapter` 依赖 `src/types/message.ts`，需确保类型可用
- `remotePermissionBridge` 依赖 `src/Tool.ts` 类型

**依赖关系**：
- 外部：`ws`, `src/constants/oauth.js`, `src/utils/mtls.js`, `src/utils/proxy.js`
- 被依赖方：`useRemoteSession.ts` hook

---

### 模块 6：前置条件检查

**文件**：`src/utils/background/remote/preconditions.ts`（235 行）、`remoteSession.ts`（98 行）

**当前状态**：已实现

**功能清单**：
- `checkNeedsClaudeAiLogin()` — 检查是否需要登录
- `checkIsGitClean()` — 检查 Git 是否干净
- `checkHasRemoteEnvironment()` — 检查是否有远程环境
- `checkIsInGitRepo()` / `checkHasGitRemote()` — Git 仓库状态检查
- `checkGithubAppInstalled()` — GitHub App 安装检查
- `checkGithubTokenSynced()` — GitHub Token 同步检查
- `checkRepoForRemoteAccess()` — 综合仓库访问检查
- `checkBackgroundRemoteSessionEligibility()` — 后台会话资格检查

**提取工作**：
- 较为独立，主要检查逻辑
- 依赖 `fetchEnvironments`（模块 2）
- 需将 `getFeatureValue_CACHED_MAY_BE_STALE` 依赖注入

**依赖关系**：
- 依赖模块 2（environments）
- 外部：`src/services/analytics/`, `src/services/policyLimits/`

---

### 模块 7：React UI 组件

**文件**：6 个 Teleport 相关组件（共 ~878 行）

**当前状态**：已实现，保留在 `src/` 中

**提取工作**：
- 不提取到 `packages/teleport`
- 重构为从 `packages/teleport` 导入业务逻辑，UI 层只做渲染

**依赖关系**：
- 依赖 `packages/teleport`（提取后）的业务 API

---

### 模块 8：React Hooks

**文件**：`useRemoteSession.ts`（607 行）、`useTeleportResume.tsx`（78 行）

**当前状态**：已实现，保留在 `src/` 中

**提取工作**：
- 不提取到 `packages/teleport`
- `useRemoteSession` 内含大量 REPL 状态管理逻辑（echo 过滤、超时重连、compaction 追踪），与 Ink/React 深度耦合
- 重构后从 `packages/teleport` 导入 `RemoteSessionManager` 和类型

---

### 模块 9：CLI 集成（main.tsx）

**文件**：`src/main.tsx`（teleport 相关约 200+ 行）

**当前状态**：已实现

**提取工作**：
- 不提取，但需更新 import 路径
- `--teleport` 和 `--remote` CLI 参数处理逻辑保持在 `main.tsx`
- 将 `dialogLaunchers.tsx` 中的 teleport launcher 更新为从新 package 导入

**依赖关系**：
- 依赖 `packages/teleport`（提取后）

---

### 模块 10：stub 文件清理

**文件**：`src/utils/teleport/src/constants/oauth.ts`、`src/utils/teleport/src/services/analytics/index.ts`、`src/utils/teleport/src/services/oauth/client.ts`

**当前状态**：已存在（`any` 类型存根）

**提取工作**：
- 删除这些存根文件，提取后直接使用实际模块的导出
- 或者如果需要解耦，设计正式的接口替代 `any` 存根

---

## 四、实施优先级与任务排序

### Phase 0：准备工作（前置条件）

| # | 任务 | 工作量 | 风险 |
|---|------|--------|------|
| 0.1 | 为现有 teleport 代码编写测试覆盖（至少 api.ts、gitBundle.ts、core 函数） | 3-5 天 | 低 |
| 0.2 | 创建 `packages/teleport/package.json` 和 `tsconfig.json`，配置 workspace 引用 | 0.5 天 | 低 |
| 0.3 | 设计依赖注入接口（OAuth、Analytics、Settings、LLM） | 1 天 | 中 |

### Phase 1：独立模块提取（低耦合，低风险）

| # | 任务 | 工作量 | 依赖 | 风险 |
|---|------|--------|------|------|
| 1.1 | 提取类型定义到 `types.ts`（SessionResource, CodeSession, Environment 等） | 0.5 天 | 0.2 | 低 |
| 1.2 | 提取 `errors.ts`（TeleportOperationError、错误工具函数） | 0.5 天 | 0.2 | 低 |
| 1.3 | 提取 `api/sessions.ts`（HTTP 客户端、重试逻辑） | 1 天 | 0.2, 0.3 | 中 |
| 1.4 | 提取 `api/environments.ts` + `api/environmentSelection.ts` | 1 天 | 1.3 | 低 |
| 1.5 | 提取 `git/bundle.ts` | 1 天 | 0.2 | 低 |
| 1.6 | 提取 `preconditions/index.ts` | 1 天 | 1.4 | 低 |

### Phase 2：核心逻辑提取（高耦合，中风险）

| # | 任务 | 工作量 | 依赖 | 风险 |
|---|------|--------|------|------|
| 2.1 | 提取 `session/createSession.ts`（teleportToRemote 核心逻辑） | 2 天 | Phase 1 全部 | 高 |
| 2.2 | 提取 `session/resumeSession.ts`（teleportResumeCodeSession） | 1 天 | 2.1 | 中 |
| 2.3 | 提取 `session/pollEvents.ts` + `session/archiveSession.ts` | 1 天 | 2.1 | 低 |
| 2.4 | 提取 `git/branchOps.ts` + `git/repositoryValidation.ts` | 1 天 | 1.2 | 中 |
| 2.5 | 提取 `remote/RemoteSessionManager.ts` + `SessionsWebSocket.ts` | 2 天 | 1.3 | 高 |
| 2.6 | 提取 `remote/sdkMessageAdapter.ts` + `remote/remotePermissionBridge.ts` | 1 天 | 2.5 | 中 |

### Phase 3：集成与迁移

| # | 任务 | 工作量 | 依赖 | 风险 |
|---|------|--------|------|------|
| 3.1 | 创建 `index.ts` 公开 API 汇总导出 | 0.5 天 | Phase 2 | 低 |
| 3.2 | 更新 `src/utils/teleport.tsx` 为 facade，转发到 `packages/teleport` | 1 天 | 3.1 | 中 |
| 3.3 | 更新 `src/remote/` 文件为 facade | 0.5 天 | 3.1 | 中 |
| 3.4 | 更新 `src/main.tsx` 和 `src/dialogLaunchers.tsx` 的 import 路径 | 1 天 | 3.2 | 中 |
| 3.5 | 更新所有 33 个引用文件的 import 路径 | 1-2 天 | 3.2, 3.3 | 低 |
| 3.6 | 删除 `src/utils/teleport/src/` 下的存根文件 | 0.5 天 | 3.5 | 低 |
| 3.7 | 验证 `bun test` 通过，`bun run build` 成功 | 1 天 | 3.5 | 中 |

### Phase 4：清理与优化

| # | 任务 | 工作量 | 依赖 | 风险 |
|---|------|--------|------|------|
| 4.1 | 移除旧 facade 文件（确认所有 import 路径已更新） | 0.5 天 | Phase 3 | 低 |
| 4.2 | 为新 package 编写集成测试 | 2 天 | Phase 3 | 低 |
| 4.3 | 性能验证：确保 import 路径变更不影响冷启动时间 | 0.5 天 | 4.2 | 低 |
| 4.4 | 文档更新：更新 CLAUDE.md 中的模块说明 | 0.5 天 | 4.1 | 低 |

---

## 五、关键风险与难点

### 1. 依赖注入复杂度（高风险）

`teleport.tsx` 直接 import 了 **20+ 个 `src/` 内部模块**（auth、git、messages、settings、sessionIngress、growthbook、policyLimits 等）。在提取为独立 package 时，这些依赖必须通过以下方式之一解耦：

- **方案 A**：依赖注入（构造函数参数或配置对象）
- **方案 B**：定义接口，由 `src/` 层提供实现并注入
- **方案 C**：保留 `src/` 路径 alias，package 直接引用（最简单但耦合度高）

**推荐**：方案 B，为每个外部依赖定义接口（如 `OAuthProvider`、`GitOperations`、`AnalyticsLogger`），在 package 初始化时注入实现。

### 2. React/UI 耦合（中风险）

`teleport.tsx` 中的 `handleTeleportPrerequisites` 和 `teleportToRemoteWithErrorHandling` 直接渲染 React 组件（`TeleportError`、`AppStateProvider`、`KeybindingSetup`）。提取时需将这些 UI 逻辑留在 `src/` 层，package 只暴露纯业务逻辑和回调接口。

### 3. chalk 输出耦合（低风险）

`TeleportOperationError` 的 `formattedMessage` 字段包含 `chalk.red()` 渲染结果。提取后需确保 chalk 依赖不成为 package 的硬依赖（可在错误类中移除格式化，由 UI 层处理）。

### 4. SDK Message 类型依赖（中风险）

`remote/sdkMessageAdapter.ts` 依赖 `src/types/message.ts` 和 `src/entrypoints/agentSdkTypes.ts` 中的类型。提取后需将这些类型定义复制到 package 中或建立类型包共享机制。

### 5. 缺乏测试覆盖（高风险）

当前 teleport 相关代码 **没有任何测试文件**。在重构前必须先建立基线测试，否则无法验证提取的正确性。这是 Phase 0 的首要任务。

### 6. 33 个引用文件的 import 路径迁移（中风险）

所有从 `src/utils/teleport`、`src/remote/` 导入的文件都需更新路径。虽然机械性工作，但遗漏会导致运行时错误。建议使用 codemod 工具辅助迁移。

### 7. Bun workspace 兼容性（低风险）

当前 `packages/` 下的包多为 `@ant/*` 命名，使用 Bun workspace `workspace:*` 协议。新增 `packages/teleport` 需确保 `tsconfig.json` 路径别名和 Bun 构建正确解析。

---

## 六、依赖关系图

```
packages/teleport
  ├── api/
  │   ├── sessions.ts          ← 环境、认证（外部注入）
  │   ├── environments.ts      ← sessions.ts
  │   └── environmentSelection.ts ← environments.ts, settings（外部注入）
  ├── git/
  │   ├── bundle.ts            ← git 工具（外部注入）、filesApi（外部注入）
  │   ├── branchOps.ts         ← git 工具（外部注入）
  │   └── repositoryValidation.ts ← detectRepository（外部注入）
  ├── session/
  │   ├── createSession.ts     ← api/*, git/*, LLM（外部注入）
  │   ├── resumeSession.ts     ← api/*, git/branchOps
  │   ├── pollEvents.ts        ← api/*
  │   └── archiveSession.ts    ← api/*
  ├── remote/
  │   ├── RemoteSessionManager.ts ← SessionsWebSocket
  │   ├── SessionsWebSocket.ts    ← OAuth（外部注入）、ws
  │   ├── sdkMessageAdapter.ts    ← types/message（外部注入）
  │   └── remotePermissionBridge.ts ← types/Tool（外部注入）
  └── preconditions/
      └── index.ts             ← api/environments, auth/git（外部注入）

src/ (消费者)
  ├── main.tsx                 ← packages/teleport (session/*)
  ├── screens/REPL.tsx         ← hooks/useRemoteSession
  ├── hooks/useRemoteSession.ts ← packages/teleport (remote/*)
  ├── hooks/useTeleportResume.tsx ← packages/teleport (session/*)
  ├── components/Teleport*.tsx   ← packages/teleport (session/*, git/*)
  └── tools/AgentTool/           ← packages/teleport (session/*)
```

---

## 七、估算总工作量

| Phase | 工作量 | 风险等级 |
|-------|--------|---------|
| Phase 0: 准备 | 4.5-6.5 天 | 低-中 |
| Phase 1: 独立模块提取 | 5 天 | 低-中 |
| Phase 2: 核心逻辑提取 | 8 天 | 中-高 |
| Phase 3: 集成迁移 | 5-6 天 | 中 |
| Phase 4: 清理优化 | 3.5 天 | 低 |
| **合计** | **~26-30 天** | |

---

## 八、验收标准

1. 所有 teleport 业务逻辑在 `packages/teleport/src/` 中，无 `src/` 内部模块的直接依赖（通过接口注入）
2. `src/` 中的 UI 组件和 hooks 从 `packages/teleport` 导入业务 API
3. `bun test` 全部通过，新增 teleport package 测试覆盖核心路径
4. `bun run build` 成功，无 import 解析错误
5. `bun run dev` 中 `--teleport` 和 `--remote` 功能与提取前行为一致
6. 旧 `src/utils/teleport/src/` 存根文件已删除
