# CLI 传输层实施计划

> 基于 `design.md` 和代码库实际状态的详细实施计划
> 优先级: P3 (入口层基础设施)
> 风险: 低

## 一、现状分析

### 已有代码规模

`src/cli/` 目录当前共约 **10,456 行**代码，其中核心文件：

| 文件 | 行数 | 状态 |
|------|------|------|
| `print.ts` | 5596 | 已实现，SDK/headless 模式主循环 |
| `structuredIO.ts` | 865 | 已实现，结构化输入输出 |
| `transports/WebSocketTransport.ts` | 800 | 已实现，WebSocket 双向通信 |
| `transports/SSETransport.ts` | 711 | 已实现，Server-Sent Events |
| `transports/ccrClient.ts` | 998 | 已实现，CCR v2 客户端协议 |
| `transports/HybridTransport.ts` | 282 | 已实现，WS读+POST写混合模式 |
| `transports/SerialBatchEventUploader.ts` | 275 | 已实现，串行批处理上传器 |
| `transports/WorkerStateUploader.ts` | 131 | 已实现，Worker 状态上传器 |
| `transports/Transport.ts` | 2 | **未实现** — 仅 `any` 类型 stub |
| `transports/transportUtils.ts` | 45 | 已实现，传输层选择工厂 |
| `remoteIO.ts` | 255 | 已实现，RemoteIO (StructuredIO 子类) |
| `handlers/` (8 文件) | 2045 | 已实现，子命令处理器 |
| `rollback.ts` | 2 | **未实现** — 空 stub |
| `update.ts` | 422 | 已实现 |
| `bg.ts` | 7 | stub |
| `exit.ts` | 31 | 已实现 |
| `ndjsonSafeStringify.ts` | 32 | 已实现 |
| `up.ts` | 2 | stub |

此外，`src/cli/src/` 下有约 80+ 个 stub 文件（`* = any` 类型占位），这些是 decompilation 产物中的类型占位符，不是实际实现。

### 已实现的 Transport 类

代码库中已有 **4 个完整实现的 Transport 类**：

1. **`WebSocketTransport`** — 完整实现 (800 行)
   - Bun native WebSocket + Node `ws` 包双运行时支持
   - 自动重连（指数退避 + 抖动 + 时间预算）
   - Ping/Pong 心跳 + Keep-alive 数据帧
   - 消息缓冲与重放（UUID 去重）
   - 进程挂起检测（系统睡眠恢复）
   - 代理支持 (HTTP/SOCKS5)

2. **`SSETransport`** — 完整实现 (711 行)
   - SSE 读取 + HTTP POST 写入
   - 事件流解析（`parseSSEFrames`）
   - 自动重连 + Last-Event-ID 断点续传
   - Liveness 超时检测
   - 序列号去重
   - Cookie 认证支持

3. **`HybridTransport`** — 完整实现 (282 行)
   - 继承 WebSocketTransport，覆写 write 为 HTTP POST
   - 串行化 POST 队列（通过 SerialBatchEventUploader）
   - stream_event 延迟缓冲 + 合批
   - 优雅关闭 + grace period

4. **`CCRClient`** — 完整实现 (998 行)
   - CCR v2 Worker 生命周期管理
   - Epoch 管理 + 409 冲突处理
   - 心跳上报
   - 事件上传（客户端事件 + 内部事件 + 投递确认）
   - stream_event 文本累积器（全量快照，非增量）
   - 分页 GET + 重试
   - JWT 过期检测

### 辅助模块

- **`SerialBatchEventUploader`** — 通用串行批处理上传器，带背压和重试
- **`WorkerStateUploader`** — Worker 状态合并上传器
- **`transportUtils.ts`** — 工厂函数 `getTransportForUrl()`，按环境变量选择传输方式

### Transport 接口

**`Transport.ts` 是唯一真正的 stub** — 当前仅 `export type Transport = any`。但所有 Transport 类已经隐含实现了统一接口（`connect`, `write`, `close`, `setOnData`, `setOnClose`, `isConnectedStatus`, `isClosedStatus`），只是没有正式的 TypeScript 类型定义。

## 二、与设计文档的差距

| 设计文档描述 | 实际状态 | 差距 |
|-------------|---------|------|
| Transport 层 (可插拔 I/O 传输) | 4 个 Transport 已实现，功能完整 | 接口未形式化（Transport.ts = any） |
| HybridTransport | 已实现 | 完全匹配 |
| SSETransport | 已实现 | 完全匹配 |
| WebSocketTransport | 已实现 | 完全匹配 |
| WorkerStateTransport | **不存在** | 设计文档中有但代码库无此独立类；WorkerStateUploader 处理了部分职责 |
| SerialBatchTransport | **不存在** | SerialBatchEventUploader 已覆盖其核心职责，但不是独立 Transport |
| StructuredIO | 已实现 | 完全匹配 |
| Rollback 机制 | 空 stub | 未实现 |
| Handler 模块 (8 个) | 已实现 | 完全匹配 |
| 提取为 packages/cli/ | 未提取 | 当前仍在 src/cli/ |

## 三、实施任务清单

### 阶段 1: 接口形式化（优先级最高）

#### 1.1 定义 Transport 接口

- **文件**: `src/cli/transports/Transport.ts`
- **当前状态**: `any` 类型 stub
- **工作内容**: 基于 WebSocketTransport、SSETransport、HybridTransport 已有的公共 API，抽取正式的 `Transport` interface：
  ```typescript
  interface Transport {
    connect(): Promise<void>
    write(message: StdoutMessage): Promise<void>
    close(): void
    setOnData(callback: (data: string) => void): void
    setOnClose(callback: (closeCode?: number) => void): void
    isConnectedStatus(): boolean
    isClosedStatus(): boolean
  }
  ```
- **依赖**: 无
- **风险**: 低 — 纯类型定义，不影响运行时

#### 1.2 让现有 Transport 类正式实现接口

- **文件**: `WebSocketTransport.ts`, `SSETransport.ts`, `HybridTransport.ts`
- **当前状态**: 隐式实现，无 `implements Transport`
- **工作内容**: 添加 `implements Transport` 声明，确保类型安全
- **依赖**: 1.1
- **风险**: 低 — 类型系统变更，编译期可验证

### 阶段 2: 缺失功能实现

#### 2.1 WorkerStateTransport（评估后建议不实现）

- **设计文档**: 列为 Worker 线程通信 Transport
- **当前状态**: WorkerStateUploader 处理了状态上传，但没有独立的 "Transport" 封装
- **建议**: WorkerStateTransport 在当前架构中对应的是 CCRClient 内部的 WorkerStateUploader。CCRClient 本身已经是对 Worker 生命周期的完整封装。**建议将设计文档中的 WorkerStateTransport 理解为已由 CCRClient + WorkerStateUploader 实现**，不需要独立抽取。
- **依赖**: 无
- **风险**: 无

#### 2.2 SerialBatchTransport（评估后建议不实现）

- **设计文档**: 串行批处理
- **当前状态**: SerialBatchEventUploader 已完整实现串行批处理功能
- **建议**: SerialBatchEventUploader 不是 Transport（它不实现 connect/close 等接口），而是被 HybridTransport 和 CCRClient 内部使用的上传原语。**设计文档中的 SerialBatchTransport 对应已实现的 SerialBatchEventUploader**。
- **依赖**: 无
- **风险**: 无

#### 2.3 Rollback 机制实现

- **文件**: `src/cli/rollback.ts`
- **当前状态**: 空 stub
- **工作内容**:
  - 分析 `print.ts` 中已有的 `handleRewindFiles` 函数（约 50 行）和 `fileHistoryRewind` 工具
  - 将 rollback 逻辑从 print.ts 提取到独立模块
  - 实现 `--rewind-files` 相关的回滚功能
- **依赖**: 无
- **风险**: 低 — print.ts 中已有参考实现

### 阶段 3: 包提取（核心重构）

#### 3.1 创建 packages/cli/ workspace 包

- **当前状态**: 所有代码在 `src/cli/` 目录下，未提取为 package
- **工作内容**:
  1. 创建 `packages/cli/package.json`（workspace:* 引用）
  2. 创建 `packages/cli/tsconfig.json`
  3. 将以下模块迁移到 `packages/cli/`:
     - `transports/` (全部文件)
     - `structuredIO.ts`
     - `remoteIO.ts`
     - `ndjsonSafeStringify.ts`
     - `handlers/` (8 个处理器)
     - `rollback.ts` (实现后)
     - `print.ts` (headless 模式主循环)
  4. 保留在 `src/cli/` 的: `exit.ts`, `bg.ts`, `up.ts`, `update.ts`（入口点文件，依赖 main.tsx）
  5. 更新所有 import 路径
- **依赖**: 阶段 1, 2
- **风险**: 中 — 大量文件迁移，import 路径变更广泛

#### 3.2 清理 src/cli/src/ stub 文件

- **当前状态**: `src/cli/src/` 下约 80+ 个 stub 文件（decompilation 产物）
- **工作内容**:
  - 审查所有 stub 文件，识别哪些有实际代码引用
  - 删除未被 import 的 stub 文件
  - 保留有实际引用的类型声明
- **依赖**: 无（可并行执行）
- **风险**: 低 — 纯清理

### 阶段 4: 测试与文档

#### 4.1 补充 Transport 层测试

- **当前状态**: 未发现专门的 Transport 测试文件
- **工作内容**:
  - `WebSocketTransport.test.ts` — 连接/重连/消息缓冲/ping-pong
  - `SSETransport.test.ts` — SSE 解析/重连/Last-Event-ID
  - `HybridTransport.test.ts` — POST 串行化/批处理/grace period
  - `CCRClient.test.ts` — epoch/心跳/事件上传/内部事件
  - `transportUtils.test.ts` — 传输选择逻辑
  - `StructuredIO.test.ts` — 已有部分覆盖，补全控制消息处理
- **依赖**: 阶段 1
- **风险**: 低

#### 4.2 集成测试

- **工作内容**:
  - RemoteIO 端到端测试（模拟 WebSocket 连接）
  - CCR v2 生命周期测试（初始化→心跳→状态上报→关闭）
- **依赖**: 阶段 1, 2
- **风险**: 中 — 需要模拟外部服务

## 四、依赖关系图

```
阶段 1.1 (Transport 接口)
  └── 阶段 1.2 (实现接口)
        └── 阶段 4.1 (Transport 测试)

阶段 2.3 (Rollback) — 独立，可与阶段 1 并行

阶段 3.1 (包提取)
  ├── 依赖阶段 1 (接口稳定)
  ├── 依赖阶段 2 (功能完整)
  └── 阶段 3.2 (清理 stub)

阶段 4.2 (集成测试)
  └── 依赖阶段 1, 2
```

## 五、风险评估

### 低风险

- Transport 接口形式化：纯类型定义，编译期验证
- Rollback 实现：print.ts 中有参考代码
- 测试补充：不改变生产代码

### 中风险

- **包提取**: `print.ts` 有 5596 行、~350 个 import，迁移到 package 后需要更新大量引用路径。`print.ts` 还依赖 `src/` 下的数十个模块（query, tools, mcp, bridge 等），提取为 package 后依赖方向可能变为双向，需要仔细设计 API 边界。
- **src/cli/src/ stub 清理**: 部分 stub 可能被间接引用，删除前需要完整的引用分析。

### 关键难点

1. **print.ts 依赖深度**: `print.ts` 是整个 headless/SDK 模式的入口，它引用了 `src/` 下几乎所有模块。将其提取到 `packages/cli/` 后，它对 `src/` 的依赖会变成包间依赖，可能导致循环依赖问题。建议分两步：先提取 Transport 层和 StructuredIO，print.ts 暂时保留在 `src/cli/`。

2. **Transport.ts 类型定义**: 虽然 4 个 Transport 类有类似的公共 API，但细节不同（例如 SSETransport 有 `setOnEvent`，WebSocketTransport 有 `setOnConnect`）。接口定义需要足够通用，或者使用联合类型。

3. **Bun/Node 双运行时**: WebSocketTransport 通过条件导入支持 Bun 和 Node.js 两个运行时。测试时需要确保两个路径都被覆盖。

## 六、实施优先级排序

1. **阶段 1.1** — Transport 接口定义（0.5 天）
2. **阶段 1.2** — 实现接口（0.5 天）
3. **阶段 2.3** — Rollback 实现（1 天）
4. **阶段 4.1** — Transport 层单元测试（2 天）
5. **阶段 3.2** — 清理 stub 文件（0.5 天）
6. **阶段 4.2** — 集成测试（1 天）
7. **阶段 3.1** — 包提取（3 天，风险最高放最后）

**总估计**: ~9 个工作日

## 七、包提取的具体建议

考虑到 `print.ts` 的庞大依赖，建议将包提取分为两期：

**第一期**: 仅提取 Transport 层
```
packages/cli/
  ├── transports/
  │   ├── Transport.ts
  │   ├── WebSocketTransport.ts
  │   ├── SSETransport.ts
  │   ├── HybridTransport.ts
  │   ├── SerialBatchEventUploader.ts
  │   ├── WorkerStateUploader.ts
  │   ├── ccrClient.ts
  │   └── transportUtils.ts
  ├── structuredIO.ts
  ├── remoteIO.ts
  └── ndjsonSafeStringify.ts
```

**第二期**: 提取 handlers 和 print.ts
```
packages/cli/
  ├── transports/  (第一期)
  ├── io/  (第一期)
  ├── handlers/
  │   ├── agents.ts
  │   ├── auth.ts
  │   ├── mcp.tsx
  │   ├── autoMode.ts
  │   ├── plugins.ts
  │   └── ...
  ├── rollback.ts
  └── print.ts
```

第二期需要先解决 print.ts 对 `src/` 模块的依赖，可能需要引入依赖注入或事件总线模式来解耦。

## 八、总结

CLI 传输层的核心功能（WebSocketTransport、SSETransport、HybridTransport、CCRClient、StructuredIO）已经完整实现，代码质量高，包含完善的错误处理、重连机制和诊断日志。主要差距在于：

1. **Transport 接口未形式化** — 需要将 `Transport.ts` 从 `any` stub 改为正式 interface
2. **Rollback 未实现** — 空 stub，但 print.ts 中有参考代码
3. **未提取为 package** — 仍在 `src/cli/` 下，需要迁移到 `packages/cli/`
4. **测试覆盖不足** — Transport 层缺少专门的单元测试

设计文档中列出的 WorkerStateTransport 和 SerialBatchTransport 在实际代码中已由 WorkerStateUploader 和 SerialBatchEventUploader 覆盖，不需要额外实现。
