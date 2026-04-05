# Storage Backend 实现计划

> 基于 `design.md` 和代码库现状调查
> 优先级: P2 | 风险: 低-中

---

## 一、概述

目标是将当前硬编码的 JSONL 文件 I/O 抽象为 `StorageBackend` 接口，支持 LocalFile / RemoteAPI / Memory 三种后端实现，使会话持久化层可插拔、可测试、可扩展。

当前核心文件共约 6904 行，全部绑定 JSONL 格式和本地文件系统：
- `src/utils/sessionStorage.ts` — 5106 行，包含 `Project` 类（写队列、刷新、远程同步）
- `src/utils/sessionRestore.ts` — 551 行，会话恢复逻辑
- `src/utils/sessionStoragePortable.ts` — 793 行，纯 Node.js 便携读写（CLI 和 VS Code 共享）
- `src/utils/listSessionsImpl.ts` — 454 行，会话列表查询

---

## 二、当前实现状态

### 2.1 已有基础（可复用）

| 模块/概念 | 文件 | 状态 | 说明 |
|-----------|------|------|------|
| 写队列 + 批量刷盘 | `sessionStorage.ts` Project 类 L532-1385 | 已实现 | `enqueueWrite` / `drainWriteQueue` / `flush` 完整工作 |
| 远程持久化 (v1 Session Ingress) | `sessionStorage.ts` `persistToRemote` L1303-1344 | 已实现 | 通过 `sessionIngress.appendSessionLog` 写入远程 API |
| 远程持久化 (CCR v2) | `sessionStorage.ts` `InternalEventWriter` L1308-1324 | 已实现 | CCR v2 内部事件写入器 |
| 远程会话恢复 | `sessionStorage.ts` `hydrateRemoteSession` L1588-1623 | 已实现 | 从远程拉取会话日志写本地文件 |
| CCR v2 会话恢复 | `sessionStorage.ts` `hydrateFromCCRv2InternalEvents` L1633-1724 | 已实现 | 从 CCR v2 内部事件恢复 |
| Session Ingress API 客户端 | `services/api/sessionIngress.ts` | 已实现 | 含重试、去重（Last-Uuid）、顺序写入 |
| 便携式 JSONL 读取 | `sessionStoragePortable.ts` | 已实现 | 无内部依赖，CLI/VS Code 共享 |
| 会话列表查询 | `listSessionsImpl.ts` | 已实现 | 基于 `readSessionLite` 的轻量元数据读取 |
| 消息链构建 | `sessionStorage.ts` `buildConversationChain` L2070+ | 已实现 | parentUuid 链 + DAG 拓扑处理 |
| Compact boundary 过滤 | `sessionStoragePortable.ts` `readTranscriptForLoad` L717+ | 已实现 | 前向分块读 + boundary 截断 |
| SecureStorage 抽象 | `utils/secureStorage/` | 已实现 | `SecureStorage` 接口 + Keychain/PlainText/Fallback 实现，可作为参考模式 |
| Settings Sync | `services/settingsSync/` | 已实现 | 远程同步模式（pull/push/ETag），可作为 RemoteAPI 后端参考 |
| Team Memory Sync | `services/teamMemorySync/` | 已实现 | 另一种远程 KV 同步，含冲突处理、secret 扫描 |

### 2.2 未实现（需新建）

| 模块/概念 | 状态 | 说明 |
|-----------|------|------|
| `StorageBackend` 接口定义 | 未实现 | 需定义 read/write/append/delete/list 标准接口 |
| `LocalFileBackend` | 未实现 | 需从 `Project` 类中提取 JSONL 文件 I/O 逻辑 |
| `RemoteAPIBackend` | 未实现 | 需整合 sessionIngress + CCR v2 路径 |
| `MemoryBackend` | 未实现 | 纯内存实现，用于测试 |
| 后端选择/注入机制 | 未实现 | 需要工厂函数或依赖注入，根据配置/环境选择后端 |
| 后端抽象层对 `sessionRestore` 的支持 | 未实现 | 恢复逻辑当前直接读 JSONL 文件 |

---

## 三、实现计划（按优先级排序）

### Phase 1: 接口定义 + Memory 后端（P2-1）

**目标**: 定义 `StorageBackend` 接口，实现 Memory 后端，为测试提供基础。

#### 3.1.1 定义 StorageBackend 接口

**新文件**: `src/services/storage/StorageBackend.ts`

```
StorageBackend 接口:
- appendEntry(sessionId, entry): Promise<void>
- readEntries(sessionId, options?): Promise<Entry[]>
- readLite(sessionId): Promise<LiteSessionFile | null>  (轻量元数据)
- deleteEntry(sessionId, uuid): Promise<void>
- listSessions(options?): Promise<SessionInfo[]>
- flush(sessionId?): Promise<void>
- exists(sessionId): boolean
```

**依赖**: `src/types/logs.ts`（Entry 类型已定义）

**风险**: 低。纯类型定义，无副作用。

#### 3.1.2 实现 MemoryBackend

**新文件**: `src/services/storage/MemoryBackend.ts`

- 基于 `Map<string, Entry[]>` 的纯内存实现
- 支持所有 `StorageBackend` 方法
- 不持久化，进程退出数据丢失
- 用于单元测试和集成测试，替代 mock fs

**依赖**: Phase 3.1.1

**风险**: 低。逻辑简单，无 I/O。

#### 3.1.3 为现有存储函数添加测试

**新文件**: `src/services/storage/__tests__/MemoryBackend.test.ts`

- 测试 appendEntry + readEntries 往返
- 测试 deleteEntry
- 测试 listSessions
- 测试 flush（no-op）

**依赖**: Phase 3.1.2

**风险**: 低。

---

### Phase 2: LocalFile 后端提取（P2-2）

**目标**: 将 `Project` 类中的文件 I/O 逻辑重构为 `LocalFileBackend`，不改变外部行为。

#### 3.2.1 提取 LocalFileBackend

**新文件**: `src/services/storage/LocalFileBackend.ts`

需要从 `Project` 类提取的核心逻辑：

| 原始位置 | 功能 | 提取方法 |
|----------|------|----------|
| `Project.enqueueWrite` / `drainWriteQueue` (L606-686) | 写队列 + 批量刷盘 | `appendEntry()` 内部实现 |
| `Project.appendToFile` (L634-643) | 文件追加写入 | 底层 `appendToFile()` |
| `Project.removeMessageByUuid` (L871-940) | 按UUID删除消息 | `deleteEntry()` 内部实现 |
| `Project.appendEntry` (L1129-1265) | 入口去重 + 类型分发 | `appendEntry()` |
| `getTranscriptPath` / `getTranscriptPathForSession` | 路径计算 | 构造函数参数或辅助方法 |
| `readFileTailSync` (文件内) | 尾部读取 | 内部工具方法 |
| `readSessionLite` (sessionStoragePortable.ts) | 轻量读取 | 委托给 portable 模块 |

**保留在 Project 类中**（不属于 StorageBackend）：
- 元数据缓存（tag, title, agentName, agentColor 等）
- `reAppendSessionMetadata` — 元数据重追加逻辑
- `materializeSessionFile` — 延迟文件创建策略
- 远程同步相关（`persistToRemote`, `setRemoteIngressUrl`）
- CCR v2 事件写入器

**依赖**: Phase 3.1.1

**风险**: **中高**。这是最核心的重构：
1. `Project` 类有 5106 行，提取需要非常小心
2. 40+ 个文件 import sessionStorage 的函数，接口变更影响面大
3. 写队列逻辑与远程持久化耦合（`appendEntry` 中调用 `persistToRemote`）
4. `parentUuid` 链逻辑嵌入在 `insertMessageChain` 中，不能简单拆分

**缓解策略**：
- 采用适配器模式：先让 `LocalFileBackend` 包装现有 `Project` 方法，而非重写
- 保持 `sessionStorage.ts` 的所有公开 API 不变，内部委托给 backend
- 逐函数迁移，每步都有测试覆盖

#### 3.2.2 适配 Project 类使用 LocalFileBackend

**修改文件**: `src/utils/sessionStorage.ts`

- `Project` 持有一个 `StorageBackend` 实例（默认 `LocalFileBackend`）
- 将 `appendEntry`、`removeMessageByUuid`、`flush` 委托给 backend
- 保持所有导出函数签名不变

**依赖**: Phase 3.2.1

**风险**: 中。需要确保行为完全一致。

#### 3.2.3 为 LocalFileBackend 添加测试

**新文件**: `src/services/storage/__tests__/LocalFileBackend.test.ts`

- 使用临时目录进行文件 I/O 测试
- 验证 appendEntry 产生正确的 JSONL 格式
- 验证 readEntries 正确解析 JSONL
- 验证 deleteEntry 正确移除指定行
- 验证并发写入安全性

**依赖**: Phase 3.2.1

**风险**: 低。

---

### Phase 3: RemoteAPI 后端整合（P2-3）

**目标**: 将远程持久化路径整合为 `RemoteAPIBackend`。

#### 3.3.1 定义 RemoteAPIBackend

**新文件**: `src/services/storage/RemoteAPIBackend.ts`

整合已有远程逻辑：

| 已有实现 | 整合方式 |
|----------|----------|
| `sessionIngress.appendSessionLog` (services/api/sessionIngress.ts) | 作为 `appendEntry()` 的远程写入路径 |
| `sessionIngress.getSessionLogs` | 作为 `readEntries()` 的远程读取路径 |
| `Project.persistToRemote` (L1303-1344) | 迁移到 RemoteAPI |
| `Project.hydrateRemoteSession` (L1588-1623) | 迁移到 RemoteAPI |
| `Project.hydrateFromCCRv2InternalEvents` (L1633-1724) | 迁移到 RemoteAPI |
| CCR v2 `InternalEventWriter`/`Reader` | 作为可选注入 |

**RemoteAPIBackend 特殊设计**：
- **写透模式**: 写入同时发往本地 + 远程（当前行为）
- **纯远程模式**: 只写远程不写本地（未来 CCR 场景）
- **回退机制**: 远程失败时 graceful shutdown（当前行为）或降级到本地

**依赖**: Phase 3.1.1

**风险**: **中**。
1. 远程写入有重试、去重（Last-Uuid）、顺序性保证，逻辑复杂
2. CCR v2 路径与 v1 Session Ingress 路径需统一接口
3. 远程失败时的 shutdown 行为需要在接口层表达

#### 3.3.2 为 RemoteAPIBackend 添加测试

**新文件**: `src/services/storage/__tests__/RemoteAPIBackend.test.ts`

- Mock `sessionIngress` API 调用
- 测试重试逻辑
- 测试 409 冲突处理
- 测试 Last-Uuid 去重
- 测试 gracefulShutdown 触发条件

**依赖**: Phase 3.3.1

---

### Phase 4: 后端选择与注入（P2-4）

**目标**: 根据运行环境自动选择或手动注入 StorageBackend。

#### 3.4.1 实现 StorageBackend 工厂

**新文件**: `src/services/storage/createStorageBackend.ts`

```
选择逻辑:
1. 测试环境 → MemoryBackend
2. 正常 CLI → LocalFileBackend（写透远程，如果配置了 ingress URL）
3. CCR v2 环境 → RemoteAPIBackend（CCR 模式）
4. 自定义注入 → 由调用方提供
```

**依赖**: Phase 3.2.1 + Phase 3.3.1

**风险**: 低。选择逻辑简单。

#### 3.4.2 修改 Project 类使用工厂

**修改文件**: `src/utils/sessionStorage.ts`

- `Project` 构造时调用 `createStorageBackend()`
- 通过 `setRemoteIngressUrl` 等方法可以动态切换后端配置
- 保持所有公开 API 不变

**依赖**: Phase 3.4.1

**风险**: 中。需要确保运行时后端切换不会丢失数据。

---

### Phase 5: sessionRestore 适配（P2-5）

**目标**: 让会话恢复逻辑通过 `StorageBackend` 读取数据。

#### 3.5.1 适配 sessionRestore.ts

**修改文件**: `src/utils/sessionRestore.ts`

当前 `sessionRestore` 直接调用 `sessionStorage` 的函数：
- `restoreSessionMetadata`, `adoptResumedSessionFile`, `resetSessionFilePointer`
- 通过 `buildConversationChain` 构建消息链

适配方向：
- 恢复逻辑通过 `StorageBackend.readEntries()` 获取数据
- 保持 `restoreSessionMetadata` 等函数签名不变
- 内部从直接读 JSONL 文件改为通过 backend 接口

**依赖**: Phase 3.2.2

**风险**: 中。恢复逻辑涉及 parentUuid 链重建、compact boundary 处理，逻辑复杂。

#### 3.5.2 适配 sessionStoragePortable.ts

**评估**: `sessionStoragePortable.ts` 是纯 Node.js 模块（无内部依赖），被 CLI 和 VS Code 共享。

**策略**: 暂不修改。`sessionStoragePortable.ts` 作为 `LocalFileBackend` 的底层实现被调用，保持其独立性。`MemoryBackend` 和 `RemoteAPIBackend` 不需要 portable 层。

**风险**: 低。

---

### Phase 6: 清理与文档（P2-6）

#### 3.6.1 清理废弃代码

- 移除 `src/cli/src/utils/sessionStorage.ts` 中的 type stub（当前只是 `export type ... = any`）
- 统一使用 `src/services/storage/` 下的接口

#### 3.6.2 更新类型声明

- 在 `src/types/` 中补充 `StorageBackend` 相关类型
- 确保 `SecureStorage` 的 types.ts 不再是 `any` stub

---

## 四、文件清单

### 新建文件

| 文件路径 | Phase | 说明 |
|----------|-------|------|
| `src/services/storage/StorageBackend.ts` | 1 | 接口定义 |
| `src/services/storage/MemoryBackend.ts` | 1 | 内存后端实现 |
| `src/services/storage/__tests__/MemoryBackend.test.ts` | 1 | 内存后端测试 |
| `src/services/storage/LocalFileBackend.ts` | 2 | 本地文件后端实现 |
| `src/services/storage/__tests__/LocalFileBackend.test.ts` | 2 | 本地文件后端测试 |
| `src/services/storage/RemoteAPIBackend.ts` | 3 | 远程 API 后端实现 |
| `src/services/storage/__tests__/RemoteAPIBackend.test.ts` | 3 | 远程 API 后端测试 |
| `src/services/storage/createStorageBackend.ts` | 4 | 后端工厂 |
| `src/services/storage/index.ts` | 4 | 模块导出 |

### 修改文件

| 文件路径 | Phase | 说明 | 影响范围 |
|----------|-------|------|----------|
| `src/utils/sessionStorage.ts` | 2, 4 | Project 类委托给 StorageBackend | 核心，40+ 文件依赖 |
| `src/utils/sessionRestore.ts` | 5 | 通过 backend 读取数据 | 中等 |
| `src/cli/src/utils/sessionStorage.ts` | 6 | 移除 type stub | 低 |

### 不修改的文件

| 文件路径 | 原因 |
|----------|------|
| `src/utils/sessionStoragePortable.ts` | 作为 LocalFileBackend 底层，保持独立 |
| `src/utils/listSessionsImpl.ts` | 通过 StorageBackend 接口调用，不直接改 |
| `src/services/api/sessionIngress.ts` | 被 RemoteAPIBackend 委托调用 |
| `src/services/teamMemorySync/` | 独立同步机制，不纳入 StorageBackend |
| `src/services/settingsSync/` | 独立同步机制，不纳入 StorageBackend |
| `src/utils/secureStorage/` | 独立抽象（凭证存储），不纳入 StorageBackend |

---

## 五、依赖关系图

```
Phase 1 (接口 + Memory)
    │
    ├── Phase 2 (LocalFile 提取) ──┐
    │                              │
    ├── Phase 3 (RemoteAPI 整合) ──┤
    │                              │
    │                   Phase 4 (工厂 + 注入)
    │                              │
    │                   Phase 5 (sessionRestore 适配)
    │                              │
    │                   Phase 6 (清理 + 文档)
```

Phase 2 和 Phase 3 可以并行开发（都只依赖 Phase 1 的接口定义）。

---

## 六、风险与难点

### 6.1 高风险：Project 类拆分

**问题**: `Project` 类（5106 行）承担了太多职责：写队列、去重、元数据缓存、远程同步、路径管理。

**缓解**: 不做一次性大重构。先让 `Project` 持有 `StorageBackend` 实例并委托文件 I/O，后续逐步迁移逻辑到对应 backend。

### 6.2 中风险：远程 + 本地写透

**问题**: 当前实现是"先写本地文件，再异步写远程"（`persistToRemote`），两者耦合在 `appendEntry` 内。拆分后需要保证：
- 本地写入失败时不尝试远程写入
- 远程写入失败时的 shutdown 行为保持不变
- 写透顺序保证（本地先于远程）

**缓解**: `RemoteAPIBackend` 可以组合 `LocalFileBackend`，内部保证写透语义。

### 6.3 中风险：parentUuid 链完整性

**问题**: `insertMessageChain` 为每个消息分配 `parentUuid`，这个逻辑与存储层紧密耦合。如果 `appendEntry` 的顺序性被打破（比如异步 backend），链会断裂。

**缓解**: `StorageBackend.appendEntry` 必须保证同一 session 内的顺序性。`MemoryBackend` 和 `LocalFileBackend` 天然满足；`RemoteAPIBackend` 需要继承 `sequential` 包装器（已在 `sessionIngress.ts` 中实现）。

### 6.4 低风险：sessionStoragePortable 独立性

`sessionStoragePortable.ts` 无内部依赖，被 CLI 和 VS Code 共享。作为 `LocalFileBackend` 的底层实现被调用，不需要修改，不影响 VS Code 扩展。

### 6.5 低风险：现有测试回归

`sessionStorage.ts` 已有的消费者（40+ 文件）通过导出函数使用。只要保持函数签名不变，内部重构不影响外部调用者。

---

## 七、参考模式

### 7.1 SecureStorage 抽象（可参考）

`src/utils/secureStorage/` 提供了类似的后端抽象模式：
- `types.ts` — 接口定义
- `macOsKeychainStorage.ts` / `plainTextStorage.ts` — 具体实现
- `fallbackStorage.ts` — 组合模式（primary + fallback）
- `index.ts` — 平台选择工厂

StorageBackend 可参考这个结构，但接口方法更复杂（涉及批量操作和顺序性保证）。

### 7.2 Session Ingress 顺序性保证（可复用）

`src/services/api/sessionIngress.ts` 中的 `sequential()` 包装器 + `lastUuidMap` 去重机制可以直接在 `RemoteAPIBackend` 中复用。

---

## 八、验收标准

1. `StorageBackend` 接口定义清晰，覆盖 read/write/append/delete/list 操作
2. `MemoryBackend` 通过完整测试，可用于所有涉及会话存储的单元测试
3. `LocalFileBackend` 正确封装现有 JSONL 文件 I/O，所有现有行为不变
4. `RemoteAPIBackend` 统一 v1 Session Ingress 和 CCR v2 路径
5. 所有 40+ 个依赖 `sessionStorage` 的文件无需修改导入路径
6. 现有测试全部通过，无回归
