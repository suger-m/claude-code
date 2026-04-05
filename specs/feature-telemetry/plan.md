# 遥测/诊断系统实施计划

> 基于 `design.md` 和代码库实际调查结果
> 优先级: P3 | 风险: 中

## 一、总体状态评估

遥测系统在代码库中**已有完整的生产级实现**，不是空 stub。核心架构已成型且功能完整，包含 1P 事件日志、GrowthBook 远程配置、Datadog 日志、OTel 三方遥测、Perfetto 本地追踪等多个子系统。设计文档中提到的建议（"暂不提取为独立 package"）与实际代码结构一致——所有模块保持在 `src/services/analytics/` 和 `src/utils/telemetry/` 中。

主要问题：
1. `src/utils/telemetry/src/` 下有 4 个 auto-generated type stub 文件（空壳），需要实现或移除
2. 缺少针对遥测核心模块的单元测试（仅 `privacyLevel.test.ts` 存在）
3. Proto 生成的类型文件已就位，但 `generate:proto` 脚本需要验证

---

## 二、模块清单与当前状态

### 2.1 1P 事件日志系统（1st-Party Event Logging）

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/services/analytics/firstPartyEventLoggingExporter.ts` | **已实现** | 807 | OTel LogExporter + JSONL 批处理 + HTTP 上传 + 磁盘持久化重试 |
| `src/services/analytics/firstPartyEventLogger.ts` | **已实现** | 449 | LoggerProvider + 采样策略 + GrowthBook 配置热更新 |
| `src/services/analytics/metadata.ts` | **已实现** | 973 | 事件元数据 enrichment（环境、进程、用户、agent 标识等） |
| `src/services/analytics/config.ts` | **已实现** | 39 | 共享 analytics 开关逻辑 |
| `src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts` | **已实现** | - | Proto 生成的类型定义 |
| `src/types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts` | **已实现** | - | Proto 生成的类型定义 |
| `src/types/generated/events_mono/common/v1/auth.ts` | **已实现** | - | Proto 生成的 Auth 类型 |

### 2.2 Analytics 公共 API 与路由

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/services/analytics/index.ts` | **已实现** | 174 | 公共 API：logEvent / logEventAsync / attachAnalyticsSink，含事件队列 |
| `src/services/analytics/sink.ts` | **已实现** | 115 | Sink 实现：路由到 Datadog 和 1P，含 Datadog gate |
| `src/services/analytics/sinkKillswitch.ts` | **已实现** | 26 | per-sink 远程开关（通过 GrowthBook 动态配置） |

### 2.3 Datadog 日志

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/services/analytics/datadog.ts` | **已实现** | 322 | Datadog HTTP 批量上传，白名单事件过滤，user bucket 分桶 |

### 2.4 GrowthBook 远程配置/Feature Flag

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/services/analytics/growthbook.ts` | **已实现** | 1163 | 完整的 GrowthBook 客户端：remoteEval、磁盘缓存、周期刷新、适配器模式 |

### 2.5 OTel 三方遥测

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/utils/telemetry/instrumentation.ts` | **已实现** | 826 | 完整 OTel SDK 初始化：metrics / logs / traces，多协议支持 |
| `src/utils/telemetry/events.ts` | **已实现** | 76 | OTel 事件日志辅助函数 |
| `src/utils/telemetry/logger.ts` | **已实现** | 27 | OTel DiagLogger 适配 |
| `src/utils/telemetry/bigqueryExporter.ts` | **已实现** | 253 | BigQuery Metrics Exporter（内部指标管道） |

### 2.6 Session Tracing（增强追踪）

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/utils/telemetry/sessionTracing.ts` | **已实现** | 928 | 完整的 span 管理：interaction / LLM request / tool / hook span |
| `src/utils/telemetry/betaSessionTracing.ts` | **已实现** | 492 | Beta 追踪特性：system prompt 去重、new_context 增量、model output 截断 |

### 2.7 Perfetto 本地追踪

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/utils/telemetry/perfettoTracing.ts` | **已实现** | 1121 | Chrome Trace Event 格式输出，ant-only，agent 层级追踪 |

### 2.8 特化遥测模块

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/utils/telemetry/skillLoadedEvent.ts` | **已实现** | 39 | skill 加载事件 |
| `src/utils/telemetry/pluginTelemetry.ts` | **已实现** | 290 | plugin 生命周期遥测（含 PII 隐私双列模式） |
| `src/hooks/toolPermission/permissionLogging.ts` | **已实现** | 239 | 工具权限决策日志 |

### 2.9 隐私/配置层

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/utils/privacyLevel.ts` | **已实现** | 56 | 隐私级别：default / no-telemetry / essential-traffic |
| `src/entrypoints/init.ts` | **已实现** | 345 | 启动初始化流程（含 1P 日志和 OTel 的延迟加载初始化） |

### 2.10 Type Stub（空壳文件）

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/utils/telemetry/src/bootstrap/state.ts` | **空壳** | 导出 any 类型的 stub（getEventLogger, getPromptId 等） |
| `src/utils/telemetry/src/utils/auth.ts` | **空壳** | 导出 any 类型的 stub（getOtelHeadersFromHelper 等） |
| `src/utils/telemetry/src/utils/platform.ts` | **空壳** | 导出 any 类型的 stub（getPlatform, getWslVersion） |
| `src/services/analytics/src/utils/user.ts` | **空壳** | 导出 any 类型（CoreUserData） |

### 2.11 不存在的文件

| 预期文件 | 状态 | 说明 |
|----------|------|------|
| `src/utils/telemetry/src/services/api/metricsOptOut.ts` | **不存在** | `bigqueryExporter.ts` 尝试从此路径 import `checkMetricsEnabled`，实际使用的是 `src/services/api/metricsOptOut.ts` |

---

## 三、按优先级排序的任务

### P0 - 阻塞性修复

#### 3.1 修复空壳 type stub 文件
- **文件**: `src/utils/telemetry/src/` 下的 3 个文件 + `src/services/analytics/src/utils/user.ts`
- **当前状态**: 导出 `any` 类型，不影响运行时但丧失类型安全
- **需要做的工作**:
  1. 检查这些文件的 import 方向——它们被谁 import
  2. 确认是遗留产物还是有意为之的 re-export 层
  3. 如果是遗留产物，将其改为从实际实现 re-export（如 `export { getPlatform, getWslVersion } from '../../utils/platform.js'`）
  4. 如果是旧 layering 的一部分，评估是否可以删除并更新 import 路径
- **依赖**: 需要理解这些文件的调用链
- **风险**: 低——这些 `any` export 不影响运行时，但清理后能改善类型检查
- **难点**: 需要追踪 import 图确认是否有循环依赖

### P1 - 重要改进

#### 3.2 补充遥测核心模块的单元测试
- **当前状态**: 仅有 `privacyLevel.test.ts`，遥测核心模块（analytics、instrumentation、sessionTracing 等）完全没有测试
- **需要做的工作**:
  1. `src/services/analytics/__tests__/config.test.ts` — 测试 `isAnalyticsDisabled()` 的各种条件组合
  2. `src/services/analytics/__tests__/metadata.test.ts` — 测试 `sanitizeToolNameForAnalytics()`、`getFileExtensionForAnalytics()`、`getFileExtensionsFromBashCommand()` 等纯函数
  3. `src/services/analytics/__tests__/sinkKillswitch.test.ts` — 测试 killswitch 行为
  4. `src/utils/telemetry/__tests__/betaSessionTracing.test.ts` — 测试 `truncateContent()`、`isBetaTracingEnabled()` 等
  5. `src/utils/telemetry/__tests__/perfettoTracing.test.ts` — 测试事件生成和 agent 注册逻辑
- **依赖**: 无
- **风险**: 低
- **难点**: 需要大量 mock（GrowthBook、auth、config 等）

#### 3.3 验证 import 路径一致性
- **当前问题**: `src/utils/telemetry/src/services/api/metricsOptOut.ts` 路径在 `bigqueryExporter.ts` 中被 import，但文件不存在
- **需要做的工作**:
  1. 确认 `bigqueryExporter.ts` 的实际 import 来源（`src/services/api/metricsOptOut.ts` 还是 stub）
  2. 如有必要，修复 import 路径
  3. 检查其他遥测文件是否有类似的错误 import
- **依赖**: 无
- **风险**: 低
- **难点**: 运行时可能正常（Bun 对 `any` 容错），但需要确认

### P2 - 质量改进

#### 3.4 验证 Proto 生成管线
- **文件**: `src/types/generated/` 下的 4 个文件
- **需要做的工作**:
  1. 确认 `bun run generate:proto` 脚本是否存在并正常工作
  2. 验证生成的类型文件与 `metadata.ts` 中的 `to1PEventFormat()` 是否对齐
  3. 确认 `EnvironmentMetadata` 类型的字段与 proto 定义一致（代码注释中提到之前有多次字段遗漏的 bug）
- **依赖**: 无
- **风险**: 中——proto 类型不匹配可能导致数据丢失
- **难点**: 需要访问 monorepo 中的 proto 定义

#### 3.5 清理 `sinkKillswitch.ts` 中的混淆配置名
- **文件**: `src/services/analytics/sinkKillswitch.ts`
- **当前状态**: 使用 `tengu_frond_boric` 作为 GrowthBook 配置名（明显是混淆/内部代号）
- **需要做的工作**: 在代码注释中添加映射说明（如果这是故意的安全混淆则保持现状）
- **依赖**: 无
- **风险**: 低

#### 3.6 文档化遥测数据流
- **需要做的工作**:
  1. 补充 `docs/telemetry-remote-config-audit.md` 中缺失的架构图
  2. 在 `docs/features/` 下添加遥测系统说明文档
- **依赖**: 无
- **风险**: 低

### P3 - 可选优化

#### 3.7 评估 GrowthBook 适配器模式
- **当前状态**: GrowthBook 支持 `CLAUDE_GB_ADAPTER_URL` + `CLAUDE_GB_ADAPTER_KEY` 适配器模式
- **需要做的工作**: 验证适配器模式在非 Anthropic 环境下的可用性，确认文档化
- **风险**: 低

#### 3.8 评估是否需要 Sentry 集成
- **当前状态**: `src/utils/sentry.ts` 被 `init.ts` 调用，但 CLAUDE.md 中标注为 "Empty implementations"
- **需要做的工作**: 确认 Sentry 是否已有实际实现，如果仍是空壳则明确标注
- **风险**: 低

---

## 四、架构依赖图

```
用户代码 (main.tsx, tools, screens)
    │
    ▼
src/services/analytics/index.ts          ← 公共 API (logEvent / logEventAsync)
    │
    ├─► src/services/analytics/sink.ts    ← 路由到 Datadog + 1P
    │       ├─► datadog.ts               ← HTTP 批量上传
    │       └─► firstPartyEventLogger.ts  ← OTel LoggerProvider
    │               └─► firstPartyEventLoggingExporter.ts  ← HTTP + 磁盘重试
    │                       └─► metadata.ts  ← 事件元数据 enrichment
    │
    ├─► growthbook.ts                    ← Feature flag / 远程配置
    │       └─► sinkKillswitch.ts        ← per-sink 开关
    │
    └─► config.ts                        ← 共享开关逻辑
            └─► privacyLevel.ts          ← 隐私级别

OTel 三方遥测 (独立管道):
    src/utils/telemetry/instrumentation.ts  ← SDK 初始化
    ├── events.ts                          ← 事件日志
    ├── sessionTracing.ts                  ← Session span 管理
    │       └── betaSessionTracing.ts      ← Beta 追踪
    ├── bigqueryExporter.ts                ← BigQuery 指标
    └── perfettoTracing.ts                 ← 本地 Perfetto 追踪

启动入口:
    src/entrypoints/init.ts
    ├── 1P 日志初始化 (延迟加载)
    └── OTel 初始化 (信任后延迟加载)
```

---

## 五、风险与难点总结

1. **循环依赖风险**: GrowthBook (`growthbook.ts`) 和 1P Logger (`firstPartyEventLogger.ts`) 之间有双向依赖——GrowthBook 调用 `is1PEventLoggingEnabled()` 和 `logGrowthBookExperimentTo1P()`，而 1P Logger 调用 GrowthBook 的动态配置。代码中已通过 `sinkKillswitch` 和延迟加载管理此风险，但重构时需格外小心。

2. **空壳文件的不确定性**: `src/utils/telemetry/src/` 下的 4 个空壳文件可能是反编译产物，也可能是有意的 layering 隔离。在清理前需要确认调用链。

3. **Proto 类型同步**: `metadata.ts` 的注释中记录了多次 proto 字段遗漏的 bug (#11318, #13924, #19448)，说明手动维护 snake_case 映射容易出错。`generate:proto` 管线需要持续维护。

4. **测试覆盖不足**: 遥测系统作为跨切面关注点，其正确性直接影响数据质量，但当前几乎零测试覆盖。优先测试纯函数（metadata 工具函数、隐私级别判定）。

5. **GrowthBook 适配器模式**: 支持非 Anthropic 端点的适配器模式（`CLAUDE_GB_ADAPTER_URL`/`CLAUDE_GB_ADAPTER_KEY`）已实现但可能未经过充分验证。

6. **设计文档建议保持不变**: `design.md` 建议"暂不提取为独立 package，保持原地，避免引入回归风险"，与代码现状完全一致。不需要做结构性重构。
