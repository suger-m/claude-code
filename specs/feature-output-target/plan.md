# Output Target 实施计划

> 基于 `design.md` 和代码库调查
> 日期: 2026-04-05

## 一、设计目标

将当前散落在各处的输出逻辑（Ink 终端渲染、headless 文本输出、SDK JSON 流）统一抽象为 `OutputTarget` 接口，使得 agent 核心逻辑与输出方式彻底解耦。

设计文档中的架构图：

```
agent (产出 Message/Event)
        │
   ┌────▼──────────┐
   │  OutputTarget  │
   │  renderMessage()       │
   │  renderToolProgress()  │
   │  renderError()         │
   │  renderPermission()    │
   └────┬──────────┘
        │
  ┌─────┼────────┬──────────┐
  │     │        │          │
Terminal  JSON   Web     Silent
(Ink)    (SDK)  (未来)   (后台)
```

## 二、当前实现状态分析

### 2.1 现有输出路径（共 4 条，无统一抽象）

| 路径 | 入口 | 输出方式 | 代码位置 |
|------|------|----------|----------|
| **交互式终端 (Ink)** | `src/screens/REPL.tsx` | React/Ink 组件直接渲染到 stdout | 170+ 组件耦合 Ink API |
| **Headless -p (text)** | `src/cli/print.ts` -> `runHeadless()` | `writeToStdout()` 写纯文本 | `print.ts` 第 911-951 行 switch 分支 |
| **Headless -p (json)** | 同上 | `jsonStringify(lastMessage)` 写 JSON | `print.ts` 第 912-921 行 |
| **Headless -p (stream-json)** | 同上 | `structuredIO.write()` 逐条写 NDJSON | `print.ts` + `structuredIO.ts` |

### 2.2 关键现有组件

#### 已实现的输出基础设施

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| **StructuredIO** | `src/cli/structuredIO.ts` | 已实现 | NDJSON 双向 I/O，处理 stdin/stdout 上的 JSON 消息流，包含权限请求、MCP、hook 回调等 |
| **RemoteIO** | `src/cli/remoteIO.ts` | 已实现 | 继承 StructuredIO，通过 SSE/WebSocket 传输，用于 SDK URL 模式 |
| **streamJsonStdoutGuard** | `src/utils/streamJsonStdoutGuard.ts` | 已实现 | 拦截 process.stdout.write，确保 stream-json 模式下 stdout 只输出合法 JSON 行 |
| **ndjsonSafeStringify** | `src/cli/ndjsonSafeStringify.ts` | 已实现 | 处理 U+2028/U+2029 行终止符的 JSON 序列化 |
| **staticRender** | `src/utils/staticRender.tsx` | 已实现 | 将 React/Ink 组件渲染为 ANSI 字符串（非 TTY 模式） |
| **exportRenderer** | `src/utils/exportRenderer.tsx` | 已实现 | 分块流式渲染消息为 ANSI/纯文本，用于导出功能 |
| **streamlinedTransform** | `src/utils/streamlinedTransform.ts`` | 已实现 | SDK 消息精简转换器，压缩工具调用为计数摘要 |
| **outputStyles** | `src/constants/outputStyles.ts` + `src/outputStyles/` | 已实现 | 输出风格系统（默认/教学/学习/插件自定义），但只影响 system prompt，不影响输出格式 |
| **writeToStdout** | `src/utils/process.ts` | 已实现 | 统一的 stdout 写入函数 |

#### 未实现的部分

| 模块 | 状态 | 说明 |
|------|------|------|
| **OutputTarget 接口** | 未实现 | 设计文档中的核心抽象层，目前不存在任何 `OutputTarget`/`outputTarget` 相关代码 |
| **TerminalOutputTarget** | 未实现 | 封装 Ink 渲染逻辑 |
| **JsonOutputTarget** | 未实现 | 封装 JSON 输出逻辑 |
| **SilentOutputTarget** | 未实现 | 封装静默/后台输出逻辑 |
| **WebOutputTarget** | 未实现 | 未来扩展，当前无需求 |

## 三、实施计划

### Phase 0: 准备工作（前置依赖）

#### 0.1 定义 OutputTarget 接口

**文件**: `src/outputTargets/types.ts`（新建）

**状态**: 未实现

**工作内容**:
- 定义 `OutputTarget` 接口，包含以下方法：
  - `renderMessage(message: Message): void | Promise<void>` — 渲染消息
  - `renderToolProgress(toolUse: ToolUseProgress): void` — 渲染工具进度
  - `renderError(error: Error): void` — 渲染错误
  - `renderPermission(request: PermissionRequest): Promise<PermissionDecision>` — 渲染权限请求
  - `flush(): Promise<void>` — 刷新缓冲
  - `close(): Promise<void>` — 关闭输出
- 定义 `OutputTargetType` 枚举: `'terminal' | 'json' | 'stream-json' | 'silent'`
- 定义 `OutputTargetFactory` 类型

**依赖**: 无

**风险**: 低。纯类型定义。

---

#### 0.2 创建 OutputTarget 工厂

**文件**: `src/outputTargets/factory.ts`（新建）

**状态**: 未实现

**工作内容**:
- 根据 `outputFormat` 和运行环境创建对应的 OutputTarget 实例
- 工厂函数签名: `createOutputTarget(format: OutputTargetType, options): OutputTarget`
- 集成点在 `src/main.tsx` 的 `.action()` 处理器中

**依赖**: 0.1

**风险**: 低

---

### Phase 1: Headless 路径重构（影响面最小，优先实施）

#### 1.1 TextOutputTarget — 封装 headless 文本输出

**文件**: `src/outputTargets/TextOutputTarget.ts`（新建）

**状态**: 未实现

**工作内容**:
- 从 `src/cli/print.ts` 的 `runHeadless()` 函数末尾 switch 分支（第 911-951 行）提取文本输出逻辑
- 封装 `writeToStdout()` 调用
- 处理 result message 的不同 subtype（success, error_during_execution, error_max_turns 等）

**当前代码位置**: `src/cli/print.ts` 第 911-951 行

**依赖**: 0.1

**风险**: 低。纯提取，不改行为。

---

#### 1.2 JsonOutputTarget — 封装 JSON 输出

**文件**: `src/outputTargets/JsonOutputTarget.ts`（新建）

**状态**: 未实现

**工作内容**:
- 从 `runHeadless()` 中 `outputFormat === 'json'` 的分支提取
- 封装 `jsonStringify(messages)` 和 `jsonStringify(lastMessage)` 逻辑
- 管理 `needsFullArray` 标志（verbose 模式需要完整数组 vs 非 verbose 只需要最后一条）

**当前代码位置**: `src/cli/print.ts` 第 845-846 行和第 912-921 行

**依赖**: 0.1

**风险**: 低

---

#### 1.3 StreamJsonOutputTarget — 封装 NDJSON 流输出

**文件**: `src/outputTargets/StreamJsonOutputTarget.ts`（新建）

**状态**: 部分实现

**说明**: `StructuredIO` 已经承担了大部分工作（序列化、stdout guard、transport）。需要将其包装为 `OutputTarget` 接口。

**工作内容**:
- 将 `StructuredIO` 适配为 `OutputTarget` 接口
- 保留 `structuredIO.write()` 的现有行为
- 集成 `streamlinedTransform` 的消息精简逻辑（当前在 `print.ts` 第 849-856 行）
- 集成 `installStreamJsonStdoutGuard()` 调用（当前在 `print.ts` 第 588-590 行）

**当前代码位置**:
- `src/cli/structuredIO.ts` — 核心实现
- `src/cli/remoteIO.ts` — 远程传输扩展
- `src/cli/print.ts` 第 581-590 行 — stdout guard 安装
- `src/cli/print.ts` 第 849-880 行 — 消息流处理

**依赖**: 0.1, 0.2

**风险**: 中。`StructuredIO` 和 `RemoteIO` 是 headless 模式的核心，改动需要仔细测试所有 SDK 集成场景。建议先做适配层（wrapper），不直接修改 `StructuredIO`。

---

#### 1.4 SilentOutputTarget — 封装静默输出

**文件**: `src/outputTargets/SilentOutputTarget.ts`（新建）

**状态**: 未实现

**工作内容**:
- 所有方法为空实现或最小日志
- 适用于后台 agent、daemon worker、环境变量 `RUNNER` 模式
- `renderPermission` 可以直接返回默认决策（deny 或根据配置决定）

**依赖**: 0.1

**风险**: 低

---

#### 1.5 重构 runHeadless 使用 OutputTarget

**文件**: `src/cli/print.ts`

**状态**: 未实现

**工作内容**:
- 修改 `runHeadless()` 接受 `OutputTarget` 实例而非直接操作 `outputFormat` 参数
- 将消息循环中的输出逻辑（第 858-909 行）委托给 `OutputTarget.renderMessage()`
- 将最终输出 switch（第 911-951 行）委托给 `OutputTarget.flush()`
- 保留 `runHeadlessStreaming()` 的流式消息生成逻辑，只改输出端

**当前代码位置**: `src/cli/print.ts` 第 449-968 行

**依赖**: 1.1, 1.2, 1.3, 1.4

**风险**: 高。这是整个 headless 路径的核心函数，有 ~520 行代码。需要：
1. 先确保所有现有测试通过
2. 逐步替换，每次只改一个输出格式
3. 保持向后兼容的 `outputFormat` 参数

---

### Phase 2: 交互式终端路径重构

#### 2.1 TerminalOutputTarget — 封装 Ink 渲染

**文件**: `src/outputTargets/TerminalOutputTarget.ts`（新建）

**状态**: 未实现

**工作内容**:
- 封装 `src/screens/REPL.tsx` 中的 Ink 渲染逻辑
- 不直接渲染 React 组件，而是将消息推入 REPL 组件的消息队列
- 保留 Ink 的交互式特性（键盘输入、进度条、权限对话框等）
- `renderPermission` 通过 REPL 的权限提示 UI 实现

**当前代码位置**: `src/screens/REPL.tsx`（~4680 行中的渲染相关部分）

**依赖**: 0.1

**风险**: 高。REPL 是最复杂的组件，170+ Ink 组件耦合严重。建议：
1. 初期只做薄封装，不改现有组件结构
2. 通过消息队列（已有的 `enqueue/dequeue` 机制）桥接
3. 不尝试将 170+ 组件一次性重构

---

#### 2.2 集成到 main.tsx 入口

**文件**: `src/main.tsx`

**状态**: 未实现

**工作内容**:
- 在 `.action()` 处理器中根据运行模式创建 OutputTarget
- 交互式: `TerminalOutputTarget`
- `-p` text: `TextOutputTarget`
- `-p --output-format=json`: `JsonOutputTarget`
- `-p --output-format=stream-json`: `StreamJsonOutputTarget`
- 后台/daemon: `SilentOutputTarget`

**当前代码位置**: `src/main.tsx` 第 1850-3940 行的 `.action()` 处理器

**依赖**: Phase 1 全部完成, 2.1

**风险**: 中。需要修改主入口逻辑，但只是路由分发，不涉及核心渲染。

---

### Phase 3: 消息管道统一

#### 3.1 统一消息类型映射

**文件**: `src/outputTargets/messageMapper.ts`（新建）

**状态**: 未实现

**工作内容**:
- 定义 `OutputMessage` 统一类型，覆盖所有输出场景
- 从 `StdoutMessage`（SDK 类型）和 `Message`（内部类型）映射到 `OutputMessage`
- 不同 OutputTarget 可以选择消费 `OutputMessage` 的不同字段
- 复用现有的 `toSDKRateLimitInfo`、`toInternalMessages` 等映射函数

**当前代码位置**:
- `src/entrypoints/sdk/controlTypes.ts` — `StdoutMessage` 类型定义
- `src/types/message.ts` — `Message` 类型体系
- `src/utils/messages/mappers.ts` — 现有映射器

**依赖**: 0.1

**风险**: 中。需要确保所有消息类型都被覆盖，不能丢失信息。

---

#### 3.2 QueryEngine 输出端抽象

**文件**: `src/QueryEngine.ts`

**状态**: 未实现

**工作内容**:
- 当前 `QueryEngine` 通过 `ask()` 生成器 yield 消息
- 将 yield 的消息统一通过 `OutputTarget` 输出
- 保持生成器模式（for-await-of）不变，只在消费端改变
- 确保流式工具进度（partial messages）也能通过 `OutputTarget` 传递

**当前代码位置**: `src/QueryEngine.ts`（整个文件）

**依赖**: 3.1

**风险**: 高。`QueryEngine` 是核心循环，涉及 compaction、file history、turn 管理等。改动必须保证：
1. 不影响 API 调用逻辑
2. 不破坏消息流顺序
3. 保持 abort/controller 的正确传播

---

### Phase 4: 清理和优化

#### 4.1 移除 print.ts 中的 outputFormat 分支

**文件**: `src/cli/print.ts`

**工作内容**:
- 一旦所有 OutputTarget 实现完成并稳定，逐步移除 `runHeadless` 中的 `outputFormat` switch 分支
- 移除 `structuredIO` 的直接操作（已被 StreamJsonOutputTarget 封装）
- 简化 `runHeadless` 签名

**依赖**: Phase 1 全部完成且稳定

**风险**: 中。需要充分测试。

---

#### 4.2 统一 export 路径

**文件**: `src/commands/export/export.tsx`, `src/utils/exportRenderer.tsx`

**工作内容**:
- 让导出功能使用 TextOutputTarget 的 `renderMessage` 逻辑
- 复用 `streamRenderedMessages` 的分块渲染机制
- 减少重复代码

**依赖**: 1.1, 3.1

**风险**: 低

---

#### 4.3 添加 OutputTarget 相关测试

**文件**: `src/outputTargets/__tests__/`（新建）

**工作内容**:
- 为每个 OutputTarget 实现编写单元测试
- 测试消息映射的完整性
- 测试工厂函数的路由逻辑
- 集成测试：确保 headless 模式行为不变

**依赖**: Phase 1 全部完成

**风险**: 低

## 四、文件变更汇总

### 新建文件

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/outputTargets/types.ts` | 0.1 | OutputTarget 接口定义 |
| `src/outputTargets/factory.ts` | 0.2 | OutputTarget 工厂 |
| `src/outputTargets/TextOutputTarget.ts` | 1.1 | 文本输出 |
| `src/outputTargets/JsonOutputTarget.ts` | 1.2 | JSON 输出 |
| `src/outputTargets/StreamJsonOutputTarget.ts` | 1.3 | NDJSON 流输出 |
| `src/outputTargets/SilentOutputTarget.ts` | 1.4 | 静默输出 |
| `src/outputTargets/TerminalOutputTarget.ts` | 2.1 | 终端输出 |
| `src/outputTargets/messageMapper.ts` | 3.1 | 消息类型映射 |
| `src/outputTargets/__tests__/*.test.ts` | 4.3 | 测试 |

### 修改文件

| 文件 | Phase | 变更范围 |
|------|-------|----------|
| `src/cli/print.ts` | 1.5, 4.1 | runHeadless 函数签名和内部输出逻辑 |
| `src/main.tsx` | 2.2 | .action() 处理器中的模式路由 |
| `src/QueryEngine.ts` | 3.2 | ask() yield 消息的输出端 |
| `src/commands/export/export.tsx` | 4.2 | 使用 TextOutputTarget |

### 不修改的文件（复用现有）

| 文件 | 说明 |
|------|------|
| `src/cli/structuredIO.ts` | 被 StreamJsonOutputTarget 适配，不直接修改 |
| `src/cli/remoteIO.ts` | 被 StreamJsonOutputTarget 适配，不直接修改 |
| `src/cli/ndjsonSafeStringify.ts` | 被 StreamJsonOutputTarget 使用 |
| `src/utils/streamJsonStdoutGuard.ts` | 被 StreamJsonOutputTarget 使用 |
| `src/utils/staticRender.tsx` | 被 TerminalOutputTarget/exportRenderer 使用 |
| `src/utils/exportRenderer.tsx` | 被 export 命令使用 |
| `src/utils/streamlinedTransform.ts` | 被 StreamJsonOutputTarget 使用 |
| `src/utils/process.ts` | `writeToStdout` 被多个 Target 使用 |

## 五、风险与难点

### 高风险

1. **print.ts 改动范围大**: `runHeadless` + `runHeadlessStreaming` 约 4000+ 行，是整个 headless 模式的核心。建议分步替换，每个 OutputTarget 独立上线。

2. **QueryEngine 是核心循环**: `ask()` 生成器被 REPL 和 headless 两种模式共享。改动输出端不能影响 API 调用、compaction、abort 等核心逻辑。

3. **170+ Ink 组件耦合**: TerminalOutputTarget 无法真正解耦 Ink 组件。短期内只能做薄封装（消息队列桥接），真正的解耦需要逐个组件重构。

4. **SDK 兼容性**: `StdoutMessage` 的 NDJSON 格式是 SDK 消费者的协议契约。StreamJsonOutputTarget 必须保持字节级兼容，不能改变 JSON 结构。

### 中风险

5. **消息类型碎片化**: 内部有 `Message`、`SDKMessage`、`StdoutMessage`、`NormalizedMessage` 等多种消息类型，映射容易遗漏字段。

6. **stream-json 的 stdout guard**: `installStreamJsonStdoutGuard()` 猴子补丁了 `process.stdout.write`，与 OutputTarget 的封装有潜在的时序冲突。

7. **权限请求的双向通信**: `renderPermission` 需要 promise 化的等待用户响应。在 Terminal 模式下通过 Ink 组件，在 SDK 模式下通过 StructuredIO 的 control_request 协议。两种模式的实现差异很大。

### 低风险

8. **TextOutputTarget 和 JsonOutputTarget**: 纯提取，逻辑简单，影响面小。

9. **SilentOutputTarget**: 空实现，无影响。

10. **工厂函数**: 纯路由分发，可测试性好。

## 六、优先级排序

1. **Phase 0** (0.1, 0.2) — 最高优先级，定义接口和工厂，为后续工作打基础
2. **Phase 1.1 ~ 1.4** — 高优先级，实现各 OutputTarget，影响面可控
3. **Phase 1.5** — 高优先级但高风险，需要慎重执行
4. **Phase 3.1** — 中优先级，消息类型统一是长期维护的基础
5. **Phase 2.1 ~ 2.2** — 中优先级，交互式终端可以后做，因为 Ink 封装已够用
6. **Phase 3.2** — 中优先级，QueryEngine 改动可延后
7. **Phase 4** — 低优先级，清理和优化

## 七、实施建议

1. **增量替换**: 不要一次性重写，先实现 OutputTarget 接口和工厂，然后逐个适配现有代码路径。每个 Phase 完成后确保所有测试通过。

2. **保持向后兼容**: `--output-format` 参数、`StructuredIO` 的公共 API、`StdoutMessage` 的 JSON 格式都必须保持兼容。

3. **测试优先**: 在实现每个 OutputTarget 之前，先基于现有 `print.ts` 的行为编写集成测试（输入 -> 输出），然后用新实现替换并验证输出一致。

4. **TerminalOutputTarget 延后**: 由于 170+ Ink 组件的耦合，交互式终端路径的重构可以放到最后，或者只做薄封装而不尝试真正解耦。

5. **feature flag 保护**: 建议用 feature flag（如 `OUTPUT_TARGET_V2`）保护新路径，允许渐进式切换。默认关闭，稳定后再移除旧路径。
