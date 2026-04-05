# Server 模式实现计划

> 基于 `specs/feature-server/design.md` 与代码库实际调查结果

## 一、模块总览

Server 模式的核心目标是让 Claude Code 以 HTTP/WebSocket 服务器的形式运行，支持远程客户端通过 `cc://` URL 或 `claude connect` 连接，实现分布式/远程交互。该功能受 `DIRECT_CONNECT` feature flag 控制，dev 和 build 默认均未启用。

文件位于 `src/server/` 目录，共 11 个文件。

---

## 二、各模块详细状态

### 2.1 已实现模块（4 个文件）

| 文件 | 行数 | 状态 | 说明 |
|------|------|------|------|
| `directConnectManager.ts` | 213 | 已实现 | DirectConnectSessionManager 类，管理 WebSocket 连接、消息收发、权限请求响应、中断信号 |
| `createDirectConnectSession.ts` | 88 | 已实现 | 向服务器 POST `/sessions` 创建会话，验证响应，返回 DirectConnectConfig |
| `types.ts` | 57 | 已实现 | Zod schema (connectResponseSchema)、ServerConfig、SessionState、SessionInfo、SessionIndexEntry 等类型定义 |
| `lockfile.ts` | 13 | 部分实现 | 类型定义完整 (ServerLockInfo)，但三个函数 (writeServerLock/removeServerLock/probeRunningServer) 均为空 stub |

**客户端侧相关已实现文件（不在 src/server/ 内）**：

| 文件 | 说明 |
|------|------|
| `src/hooks/useDirectConnect.ts` (229行) | React hook，管理 WebSocket 到服务器的连接，处理消息转换、权限请求 UI |
| `src/screens/REPL.tsx` (相关行) | 集成 useDirectConnect，支持 remote mode 切换 |
| `src/main.tsx` (多处) | `claude server` / `claude open` 命令注册、cc:// URL 解析重写、DirectConnect 会话启动流程 |
| `src/remote/sdkMessageAdapter.ts` | SDK 消息格式到内部 Message 格式的转换 |
| `src/bootstrap/state.ts` | directConnectServerUrl 全局状态 |

### 2.2 未实现模块（7 个文件，均为 stub）

| 文件 | 当前代码 | 需要实现的功能 | 优先级 |
|------|----------|----------------|--------|
| `server.ts` | 返回空对象 `{ stop() {} }` | **核心 HTTP 服务器**：启动 HTTP + WebSocket 服务，监听端口/Unix socket，路由请求到 SessionManager | P0 |
| `sessionManager.ts` | 空类，仅 `destroyAll()` 返回空 Promise | **会话管理器**：创建/销毁/复用会话，管理会话生命周期 (starting/running/detached/stopping/stopped)，超时清理，最大会话数限制 | P0 |
| `dangerousBackend.ts` | 空类 | **后端执行器**：实际启动 claude CLI 子进程来处理请求，管理 stdin/stdout/stderr 管道，将 SDK 格式消息桥接到 HTTP/WS | P0 |
| `lockfile.ts` (函数体) | 三个 async 函数返回空 | **PID 锁文件**：写入/删除/探测 `~/.claude/server.lock`，防止多实例冲突 | P1 |
| `serverBanner.ts` | 空函数 | **启动横幅**：在终端打印服务器地址、端口、auth token 等启动信息 | P2 |
| `serverLog.ts` | 返回空对象 | **服务器日志**：结构化日志记录器，记录请求/会话/错误等事件 | P2 |
| `parseConnectUrl.ts` | 返回空对象 `{ serverUrl: '', authToken: '' }` | **URL 解析**：解析 `cc://` 和 `cc+unix://` 格式的连接 URL，提取服务器地址和认证 token | P1 |

### 2.3 `connectHeadless.ts` (特殊)

当前为空 stub `() => Promise.resolve()`。该模块用于 `claude open <cc-url> -p` (headless/print mode) 场景，需要：
- 建立 WebSocket 连接到服务器
- 发送 prompt，接收流式响应
- 按 outputFormat (text/json/stream-json) 格式化输出到 stdout
- 不需要 TUI，纯 headless 运行

**状态**：未实现

---

## 三、依赖关系

```
main.tsx (入口)
  ├── claude server 命令
  │     ├── server.ts (startServer) ──→ sessionManager.ts
  │     ├── backends/dangerousBackend.ts ──→ 启动 claude 子进程
  │     ├── lockfile.ts (防重复启动)
  │     ├── serverBanner.ts (打印启动信息)
  │     └── serverLog.ts (日志)
  │
  ├── cc:// URL 解析
  │     └── parseConnectUrl.ts
  │
  └── claude open 命令 (headless)
        ├── parseConnectUrl.ts
        ├── createDirectConnectSession.ts ──→ types.ts
        └── connectHeadless.ts

REPL (交互模式)
  └── useDirectConnect.ts hook
        └── directConnectManager.ts ──→ WebSocket 连接管理
```

**关键依赖**：
- `server.ts` 依赖 `sessionManager.ts` 和 `dangerousBackend.ts`
- `sessionManager.ts` 依赖 `dangerousBackend.ts` 来启动实际工作进程
- 客户端侧（directConnectManager 等）已完整实现，服务端侧（server.ts 等）全部缺失

---

## 四、实现计划（按优先级排序）

### Phase 1: 基础设施（P0）

#### 4.1 实现 `parseConnectUrl.ts`
- 解析 `cc://host:port?token=xxx` 和 `cc+unix:///path/to/socket?token=xxx` 两种格式
- 返回 `{ serverUrl, authToken }` 对象
- 添加 URL 格式验证和错误处理
- **工作量**：约 30-50 行
- **风险**：低 — 纯解析逻辑，无外部依赖

#### 4.2 实现 `lockfile.ts` 函数体
- 锁文件路径：`~/.claude/server.lock`（JSON 格式，包含 pid/port/host/httpUrl/startedAt）
- `writeServerLock`：原子写入
- `removeServerLock`：进程退出时清理
- `probeRunningServer`：检查锁文件，如存在则验证 PID 是否存活
- **工作量**：约 40-60 行
- **风险**：低 — 文件系统操作，但需注意竞态条件（多个进程同时启动）

#### 4.3 实现 `dangerousBackend.ts`
- 核心功能：启动 `claude` CLI 子进程，通过 stdin/stdout 传递 SDK 格式消息
- 支持配置：cwd、权限模式、dangerouslySkipPermissions
- 管理子进程生命周期（启动、健康检查、优雅退出、强制终止）
- 实现消息桥接：将 HTTP/WebSocket 请求转换为子进程 stdin 输入，将子进程 stdout 输出转换为 WebSocket 消息
- **工作量**：约 200-300 行
- **风险**：中 — 需要处理子进程管理、信号传递、消息格式适配
- **难点**：
  - 子进程 stdio 的行缓冲/流式处理
  - 会话恢复（子进程崩溃后重新连接）
  - 大量并发会话的资源管理

#### 4.4 实现 `sessionManager.ts`
- 会话创建：POST `/sessions` 的处理逻辑
- 会话状态机：starting → running → detached → stopping → stopped
- 会话复用：相同 cwd 可复用已有会话
- 超时清理：idleTimeoutMs 到期自动 detach/stop
- 最大会话数限制
- SessionIndex 持久化到 `~/.claude/server-sessions.json`
- **工作量**：约 250-400 行
- **风险**：高 — 核心模块，涉及并发、状态管理、持久化
- **难点**：
  - 会话状态并发安全
  - 异常情况下的状态恢复（服务器重启后）
  - 内存泄漏防护（长时间运行的服务器）

#### 4.5 实现 `server.ts`
- 基于 Bun.serve() 创建 HTTP + WebSocket 服务器
- 路由：
  - `POST /sessions` → 创建会话
  - `GET /health` → 健康检查
  - `WS /sessions/:id/ws` → WebSocket 连接
- 认证：Bearer token 验证
- 支持绑定 TCP 端口或 Unix domain socket
- 优雅关闭：停止接受新连接 → 关闭现有连接 → 清理资源
- **工作量**：约 200-300 行
- **风险**：高 — 核心模块，需要处理网络、并发、安全
- **难点**：
  - WebSocket 连接管理（心跳、重连、超时）
  - Unix socket 权限和清理
  - 优雅关闭保证不丢失消息

### Phase 2: 辅助功能（P1-P2）

#### 4.6 实现 `connectHeadless.ts`
- 建立 WebSocket 连接到服务器
- 发送单个 prompt，接收流式响应
- 支持三种输出格式：text / json / stream-json
- interactive 模式：持续接收消息直到用户中断
- **工作量**：约 100-150 行
- **风险**：中 — 依赖 server.ts 正常工作
- **依赖**：Phase 1 完成

#### 4.7 实现 `serverBanner.ts`
- 终端格式化输出：服务器地址、端口、auth token
- Unix socket 模式下显示 socket 路径
- 可能包含连接示例命令
- **工作量**：约 30-50 行
- **风险**：低

#### 4.8 实现 `serverLog.ts`
- 结构化日志记录器
- 支持日志级别（debug/info/warn/error）
- 可能写文件或输出到 stderr
- **工作量**：约 40-60 行
- **风险**：低

### Phase 3: 测试与完善

#### 4.9 编写单元测试
- `parseConnectUrl` — URL 解析各种格式和边界情况
- `lockfile` — 文件读写、竞态条件、PID 检测
- `createDirectConnectSession` — mock fetch 测试各种 HTTP 响应
- `sessionManager` — 会话状态转换、超时、最大会话数
- **工作量**：约 300-500 行测试代码
- **依赖**：Phase 1-2 完成

#### 4.10 编写集成测试
- 启动实际服务器 → 创建会话 → WebSocket 连接 → 发送消息 → 接收响应
- 优雅关闭流程
- 多客户端并发
- **工作量**：约 200-300 行
- **依赖**：Phase 1 完成

---

## 五、风险与难点

### 5.1 高风险

1. **消息格式兼容性**：服务器需要以 SDK 格式 (`SDKMessage`) 与子进程通信，而客户端期望的格式也必须匹配。类型定义已存在于 `src/entrypoints/agentSdkTypes.ts` 和 `src/entrypoints/sdk/controlTypes.ts`，但实现时需确保消息序列化/反序列化完全正确。

2. **并发会话管理**：服务器需要同时管理多个会话，每个会话是一个独立的 claude 子进程。需要正确处理进程资源限制、僵尸进程回收、内存管理。

3. **权限模型**：`dangerouslySkipPermissions` 模式下的安全性，以及正常模式下权限请求/响应的跨网络传递。当前客户端侧 (`useDirectConnect.ts`) 已实现了权限请求的 UI 桥接，但服务端需要正确转发。

### 5.2 中风险

4. **Feature flag 未默认启用**：`DIRECT_CONNECT` 在 dev 和 build 默认配置中均未启用。开发和测试需要手动设置 `FEATURE_DIRECT_CONNECT=1`。建议在实现完成后再加入默认配置。

5. **子进程管理复杂性**：`dangerousBackend.ts` 需要管理 claude 子进程的完整生命周期，包括启动参数构造、stdio 管道、信号处理、异常恢复。

6. **WebSocket 稳定性**：长时间运行的 WebSocket 连接需要心跳机制、自动重连、超时断开等处理。

### 5.3 低风险

7. **类型系统**：`types.ts` 中的类型定义已经完整且合理，可以作为实现的基础契约。

8. **客户端侧已实现**：`directConnectManager.ts`、`useDirectConnect.ts`、`createDirectConnectSession.ts` 均已完整实现，可以作为服务端实现的消息格式参考。

---

## 六、实现建议

1. **先实现 `parseConnectUrl.ts` 和 `lockfile.ts`**：这两个模块最简单、无依赖，可以快速验证 feature flag 和模块导入链路。

2. **以 `directConnectManager.ts` 为参考实现服务端**：客户端的 WebSocket 消息处理逻辑（消息过滤、类型判断、JSON 解析）可以直接镜像到服务端。

3. **`dangerousBackend.ts` 核心是子进程启动**：参考 `src/utils/teleport.ts` 和 SSH 相关代码中的子进程管理模式。核心命令大致为：
   ```
   claude --input-format stream-json --output-format stream-json [其他参数]
   ```

4. **分步验证**：每实现一个模块，用 `FEATURE_DIRECT_CONNECT=1 bun run dev` 进行手动测试，确认 import 链路通畅。

5. **暂不加入默认 feature 列表**：待全部模块实现并通过测试后，再考虑将 `DIRECT_CONNECT` 加入 `scripts/dev.ts` 的默认 features。

---

## 七、文件清单汇总

| 文件路径 | 当前状态 | 需要的工作量 | 优先级 |
|----------|----------|-------------|--------|
| `src/server/parseConnectUrl.ts` | Stub (3行) | ~30-50行 | P0 |
| `src/server/lockfile.ts` | 类型已有，函数体为空 | ~40-60行 | P1 |
| `src/server/backends/dangerousBackend.ts` | Stub (3行) | ~200-300行 | P0 |
| `src/server/sessionManager.ts` | Stub (3行) | ~250-400行 | P0 |
| `src/server/server.ts` | Stub (3行) | ~200-300行 | P0 |
| `src/server/connectHeadless.ts` | Stub (3行) | ~100-150行 | P1 |
| `src/server/serverBanner.ts` | Stub (3行) | ~30-50行 | P2 |
| `src/server/serverLog.ts` | Stub (3行) | ~40-60行 | P2 |
| `src/server/directConnectManager.ts` | 已实现 (213行) | 无需修改 | - |
| `src/server/createDirectConnectSession.ts` | 已实现 (88行) | 无需修改 | - |
| `src/server/types.ts` | 已实现 (57行) | 可能需要扩展 | - |

**预估总工作量**：约 900-1400 行新代码 + 300-800 行测试代码。
