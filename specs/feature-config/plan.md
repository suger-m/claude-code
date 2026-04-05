# 配置管理系统 — 实现计划

> 基于 `design.md` 设计文档与代码库现状调查
> 调查日期: 2026-04-05

## 一、现状总结

### 1.1 代码分布

配置相关代码目前散布在两个主要位置，尚未抽取为独立 `packages/config`：

| 位置 | 文件数 | 总行数 | 说明 |
|------|--------|--------|------|
| `src/utils/config.ts` | 1 | 1821 | GlobalConfig：全局用户配置 (~/.claude.json)，含读写、缓存、锁、备份、迁移 |
| `src/utils/settings/` | 19 | ~5012 | Settings：多层优先级合并的 settings 系统（settings.json / managed / MDM） |
| `src/services/settingsSync/` | 2+ | ~200+ | 跨设备同步（增量上传/下载） |
| `src/services/remoteManagedSettings/` | 4+ | ~300+ | 远程企业管理配置拉取 |
| `src/services/analytics/growthbook.ts` | 1 | ~600+ | GrowthBook feature flag 客户端 |
| `src/utils/configConstants.ts` | 1 | 21 | 常量（通知渠道、编辑器模式） |
| `src/utils/model/configs.ts` | 1 | ~100 | 模型名称配置映射 |

### 1.2 两套配置系统共存

代码库中存在两套**独立但并行**的配置系统：

1. **GlobalConfig**（`src/utils/config.ts`）
   - 存储：`~/.claude.json` 单文件
   - 内容：用户偏好、OAuth 信息、功能使用计数、缓存值
   - 被引用：61 个文件直接 import
   - 特点：文件锁 + 写穿透缓存 + 新鲜度监控 + 自动备份

2. **Settings**（`src/utils/settings/`）
   - 存储：多文件分层（`settings.json` / `settings.local.json` / `managed-settings.json` / MDM / 远程）
   - 内容：权限规则、工具配置、hooks、MCP、企业策略
   - 合并策略：低优先级 → 高优先级，数组拼接去重
   - 特点：Zod schema 验证 + chokidar 文件监听 + 变更检测 + 热加载

### 1.3 Feature Flag 系统

- 入口：`import { feature } from 'bun:bundle'`
- 被引用：138 个文件
- 后端：GrowthBook SDK（远程实验平台），同时支持环境变量 `FEATURE_<FLAG>=1`
- 缓存：值缓存在 GlobalConfig 的 `cachedGrowthBookFeatures` / `cachedStatsigGates` 中
- Dev/Build 各有默认启用的 feature 列表

### 1.4 设计文档 vs 现状差异

| 设计文档描述 | 现状 |
|-------------|------|
| 提取为独立 `packages/config` (~9700 行) | 代码仍在 `src/utils/` 和 `src/services/`，无 `packages/config` |
| `SettingsManager` 统一接口 | 不存在统一接口，GlobalConfig 和 Settings 各自独立读写 |
| `FeatureFlagProvider` 抽象 | 无抽象层，直接 `feature()` 调用 bun:bundle |
| `SettingsSync` | 已部分实现 (`src/services/settingsSync/`)，但仅在特定 feature 下启用 |
| 7 层优先级合并 | 实际为 5 层：userSettings → projectSettings → localSettings → flagSettings → policySettings（无 GrowthBook 和 session 作为正式层） |
| `get(key) / set(key, value, source) / watch(key, cb)` | 不存在统一 API，各处直接调用 `getGlobalConfig()` / `getInitialSettings()` / `getSettingsForSource()` |

---

## 二、目标

将分散的配置代码提取为 `packages/config` 独立包，提供统一的配置管理接口，作为最底层基础设施供所有其他模块（agent、permission、tool 等）依赖。

---

## 三、模块拆分与实现计划

### 优先级 P0 — 核心提取（无功能变更，纯搬移）

#### 3.1 `packages/config/settings/` — Settings 系统

**当前状态**: 已实现，完整功能
**需要做的**: 从 `src/utils/settings/` 搬移 + 重导出

| 源文件 | 行数 | 说明 |
|--------|------|------|
| `src/utils/settings/types.ts` | 1155 | SettingsSchema (Zod) + 类型定义 |
| `src/utils/settings/settings.ts` | 1015 | 核心读取/合并/写入逻辑 |
| `src/utils/settings/settingsCache.ts` | 80 | 会话级缓存 |
| `src/utils/settings/constants.ts` | 202 | SettingSource 枚举、路径辅助 |
| `src/utils/settings/validation.ts` | 265 | Zod 错误格式化 + 验证 |
| `src/utils/settings/validationTips.ts` | 164 | 验证提示 |
| `src/utils/settings/permissionValidation.ts` | 262 | 权限规则验证 |
| `src/utils/settings/toolValidationConfig.ts` | 103 | 工具验证配置 |
| `src/utils/settings/changeDetector.ts` | 488 | 文件变更检测 (chokidar) |
| `src/utils/settings/applySettingsChange.ts` | 92 | 变更应用到 AppState |
| `src/utils/settings/internalWrites.ts` | 37 | 内部写入追踪 |
| `src/utils/settings/managedPath.ts` | 34 | managed 路径解析 |
| `src/utils/settings/pluginOnlyPolicy.ts` | 60 | 企业插件策略 |
| `src/utils/settings/schemaOutput.ts` | 8 | JSON Schema 输出 |
| `src/utils/settings/allErrors.ts` | 32 | 错误收集 |
| `src/utils/settings/validateEditTool.ts` | — | 编辑工具验证 |
| `src/utils/settings/mdm/` (3 文件) | 527 | MDM 配置 (macOS plist / Windows registry) |

**依赖关系**:
- 依赖 `src/utils/` 下的多个工具函数 (`envUtils`, `file`, `fsOperations`, `json`, `lockfile`, `slowOperations`, `debug`, `diagLogs`, `cleanupRegistry`, `hooks`, `signal`, `platform`, `git/gitignore`)
- 依赖 `src/bootstrap/state.ts`（`getOriginalCwd`, `getAllowedSettingSources`, `getFlagSettingsPath` 等）
- 依赖 `src/services/remoteManagedSettings/`（远程配置）
- 依赖 `src/services/analytics/growthbook.ts`（feature flag 查询）
- 被依赖：几乎所有上层模块

**难点**:
- 循环依赖风险极高 — settings → growthbook → config → settings 形成环
- bootstrap/state 是全局单例，提取时需要设计注入机制
- `applySettingsChange` 直接操作 AppState 类型，与 UI 层耦合

#### 3.2 `packages/config/global/` — GlobalConfig 系统

**当前状态**: 已实现，完整功能
**需要做的**: 从 `src/utils/config.ts` 搬移 + 重导出

| 源文件 | 行数 | 说明 |
|--------|------|------|
| `src/utils/config.ts` | 1821 | GlobalConfig 类型、读写、缓存、锁、备份、迁移 |
| `src/utils/configConstants.ts` | 21 | 通知渠道、编辑器模式常量 |

**依赖关系**:
- 依赖 `src/utils/` 下的 `env`, `envUtils`, `errors`, `file`, `fsOperations`, `git`, `json`, `jsonRead`, `lockfile`, `log`, `path`, `slowOperations`, `cleanupRegistry`, `debug`, `diagLogs`
- 依赖 `src/bootstrap/state.ts`
- 依赖 `src/services/analytics/index.ts`（`logEvent`）
- 依赖 `src/utils/settings/managedPath.ts`
- 被依赖：61 个文件

**难点**:
- 与 analytics 形成 `config → logEvent → getGlobalConfig → getConfig` 的递归风险（已有 `insideGetConfig` 守卫）
- 包含大量非配置逻辑（用户 ID 生成、内存路径解析、自动更新策略、trust dialog）

---

### 优先级 P1 — 统一接口层

#### 3.3 `packages/config/manager.ts` — SettingsManager

**当前状态**: 未实现
**需要做的**: 设计并实现统一配置管理接口

```typescript
// 设计目标 API
interface SettingsManager {
  // 读取（优先级合并后的最终值）
  get<K extends keyof SettingsJson>(key: K): SettingsJson[K]

  // 写入（指定来源）
  set<K extends keyof SettingsJson>(
    key: K,
    value: SettingsJson[K],
    source: EditableSettingSource,
  ): void

  // 监听变更
  watch<K extends keyof SettingsJson>(
    key: K,
    callback: (newValue: SettingsJson[K], source: SettingSource) => void,
  ): () => void  // unsubscribe

  // 获取指定来源的原始值
  getForSource(source: SettingSource): SettingsJson | null

  // 获取全局配置
  getGlobalConfig(): GlobalConfig
  saveGlobalConfig(updater: (current: GlobalConfig) => GlobalConfig): void
}
```

**依赖**: P0 完成
**难点**:
- GlobalConfig 和 Settings 的 key 空间完全不同，需要设计合理的统一入口
- watch 机制需要对接现有的 `changeDetector` 信号系统
- 部分调用点需要同时读写两套系统（如权限相关）

#### 3.4 `packages/config/feature-flags.ts` — FeatureFlagProvider

**当前状态**: 部分实现（`bun:bundle` 的 `feature()` + GrowthBook SDK）
**需要做的**: 封装统一接口，保留 `bun:bundle` 作为底层

```typescript
// 设计目标 API
interface FeatureFlagProvider {
  feature(name: string): boolean
  getFeatureValue<T>(name: string): T | undefined
  onRefresh(callback: () => void): () => void
}
```

**依赖**: P0 完成
**难点**:
- `feature()` 是 Bun 编译时内置函数，无法完全替换
- 138 个调用点需要逐步迁移，不能一次性改完
- GrowthBook 初始化依赖 OAuth 认证状态，存在启动时序问题

---

### 优先级 P2 — 基础设施整合

#### 3.5 `packages/config/sync/` — SettingsSync

**当前状态**: 已部分实现（`src/services/settingsSync/`）
**需要做的**: 搬移到 package 内，统一接口

| 源文件 | 说明 |
|--------|------|
| `src/services/settingsSync/index.ts` | 增量上传/下载 |
| `src/services/settingsSync/types.ts` | 同步数据 schema |

**依赖**: P0 完成
**风险**: 依赖 OAuth 认证和 API 端点，测试需 mock

#### 3.6 `packages/config/remote/` — RemoteManagedSettings

**当前状态**: 已部分实现（`src/services/remoteManagedSettings/`）
**需要做的**: 搬移到 package 内

| 源文件 | 说明 |
|--------|------|
| `src/services/remoteManagedSettings/index.ts` | 远程配置拉取 + checksum 校验 |
| `src/services/remoteManagedSettings/syncCache.ts` | 资格判断 |
| `src/services/remoteManagedSettings/syncCacheState.ts` | 同步缓存状态 |
| `src/services/remoteManagedSettings/securityCheck.tsx` | 安全检查 |
| `src/services/remoteManagedSettings/types.ts` | 类型定义 |

**依赖**: P0 完成
**风险**: 安全检查模块使用 JSX（React 组件），包内需支持 TSX

---

### 优先级 P3 — 清理与优化

#### 3.7 清理 GlobalConfig 中的非配置职责

**当前状态**: `config.ts` 包含大量与配置无关的职责
**需要做的**: 将以下职责迁移到合适的模块

| 职责 | 建议迁移目标 |
|------|-------------|
| `getOrCreateUserID()` | `src/utils/user.ts` |
| `recordFirstStartTime()` | `src/entrypoints/init.ts` |
| `getMemoryPath()` | `src/memdir/paths.ts` |
| `getManagedClaudeRulesDir()` / `getUserClaudeRulesDir()` | `src/utils/claudemd.ts` |
| `isAutoUpdaterDisabled()` / `shouldSkipPluginAutoupdate()` | `src/utils/updater.ts` |
| `checkHasTrustDialogAccepted()` / `isPathTrusted()` | `src/utils/trust.ts` |
| `getCustomApiKeyStatus()` | `src/utils/auth.ts` |
| `getRemoteControlAtStartup()` | `src/bridge/` |
| 迁移函数 (`migrateConfigFields`, `removeProjectHistory`) | `src/migrations/` |

#### 3.8 统一测试

**当前状态**: 测试分散
**需要做的**:
- 将 `src/utils/settings/__tests__/config.test.ts` 迁入 `packages/config/`
- 将 `src/utils/__tests__/configConstants.test.ts` 迁入
- 为 SettingsManager / FeatureFlagProvider 新增单元测试
- 为包迁移编写集成测试，确保行为不变

---

## 四、依赖图

```
packages/config (本包)
  ├── settings/          ← P0: 从 src/utils/settings/ 搬移
  ├── global/            ← P0: 从 src/utils/config.ts 搬移
  ├── manager.ts         ← P1: 统一 SettingsManager 接口
  ├── feature-flags.ts   ← P1: 统一 FeatureFlagProvider
  ├── sync/              ← P2: 从 src/services/settingsSync/ 搬移
  ├── remote/            ← P2: 从 src/services/remoteManagedSettings/ 搬移
  └── index.ts           ← 重导出

外部依赖（需保留引用）:
  packages/config → src/bootstrap/state.ts (全局单例注入)
  packages/config → src/utils/* (工具函数)
  packages/config → src/services/analytics/growthbook.ts (feature flag)
  packages/config → zod, lodash-es, chokidar, axios

被依赖方:
  packages/agent → packages/config
  packages/permission → packages/config
  src/tools/* → packages/config
  src/services/* → packages/config
  src/components/* → packages/config
```

---

## 五、风险与难点

### 5.1 循环依赖（高风险）

当前代码存在多个循环依赖链：
- `config.ts` → `analytics/index.ts` (logEvent) → `analytics/growthbook.ts` → `config.ts` (getGlobalConfig)
- `settings.ts` → `changeDetector.ts` → `hooks.ts` → ... → `settings.ts`

**缓解措施**: 提取时将日志记录、事件上报等副作用接口化（依赖注入），由包外部的调用方提供实现。

### 5.2 Bootstrap 时序（中风险）

`config.ts` 有 `configReadingAllowed` 门控，`settings.ts` 依赖 `getOriginalCwd()` 等 bootstrap 单例。提取后需确保：
- 包内代码不产生模块初始化时的副作用
- 所有状态通过显式初始化函数注入

### 5.3 大规模 import 重写（中风险）

- `getGlobalConfig` / `saveGlobalConfig` 被 61 个文件引用
- `feature()` 被 138 个文件引用
- settings 相关被 31+ 个文件引用

**缓解措施**:
1. P0 阶段在 `src/utils/config.ts` 和 `src/utils/settings/` 保留 re-export，不修改调用方
2. 逐步迁移调用方到新 import 路径
3. 最终删除旧文件

### 5.4 GrowthBook 依赖（低风险）

Feature flag 系统强耦合 GrowthBook SDK。`feature()` 是 Bun 编译时函数，无法在 package 内重新实现。建议 P1 阶段仅做接口封装，底层仍调用 `bun:bundle`。

### 5.5 测试覆盖

当前 settings 测试集中在 `src/utils/settings/__tests__/config.test.ts`，GlobalConfig 测试分散在各使用模块中。提取后需要：
- 确保包内所有核心函数有独立测试
- 包级别的集成测试验证合并/缓存/变更检测行为不变

---

## 六、实施步骤（建议顺序）

### Phase 1: 纯搬移（1-2 天）

1. 创建 `packages/config/` 目录结构
2. 将 `src/utils/settings/` 全部文件复制到 `packages/config/settings/`
3. 将 `src/utils/config.ts` + `configConstants.ts` 复制到 `packages/config/global/`
4. 在 `packages/config/` 创建 `index.ts`，统一重导出
5. 在原位置 (`src/utils/config.ts`, `src/utils/settings/`) 改为从 `packages/config` re-export
6. 运行全量测试确认无回归

### Phase 2: 接口设计（2-3 天）

7. 实现 `SettingsManager` 接口
8. 实现 `FeatureFlagProvider` 接口
9. 为新接口编写单元测试
10. 选取 5-10 个调用点迁移到新接口验证

### Phase 3: 基础设施整合（1-2 天）

11. 搬移 `services/settingsSync/` 到 `packages/config/sync/`
12. 搬移 `services/remoteManagedSettings/` 到 `packages/config/remote/`
13. 更新所有 import 路径

### Phase 4: 清理优化（2-3 天）

14. 将 GlobalConfig 中的非配置职责迁移到对应模块
15. 逐步更新剩余调用方的 import 路径
16. 删除原位置的 re-export 桩文件
17. 完善测试覆盖

---

## 七、文件清单

### 需要创建的文件

| 文件路径 | 说明 |
|---------|------|
| `packages/config/package.json` | Bun workspace 包配置 |
| `packages/config/tsconfig.json` | TypeScript 配置 |
| `packages/config/index.ts` | 统一导出 |
| `packages/config/settings/` | 从 `src/utils/settings/` 搬移 |
| `packages/config/global/` | 从 `src/utils/config.ts` 搬移 |
| `packages/config/manager.ts` | SettingsManager 统一接口 (新) |
| `packages/config/feature-flags.ts` | FeatureFlagProvider 统一接口 (新) |
| `packages/config/sync/` | 从 `src/services/settingsSync/` 搬移 |
| `packages/config/remote/` | 从 `src/services/remoteManagedSettings/` 搬移 |

### 需要修改的文件

| 文件路径 | 修改内容 |
|---------|---------|
| `package.json` | 添加 `packages/config` 到 workspaces |
| `tsconfig.json` | 添加 `packages/config` 的 path alias |
| `src/utils/config.ts` | 改为 re-export from `packages/config` |
| `src/utils/configConstants.ts` | 改为 re-export from `packages/config` |
| `src/utils/settings/*.ts` | 改为 re-export from `packages/config` |
| 61+ 调用 `getGlobalConfig` 的文件 | 逐步更新 import 路径 |
| 138+ 调用 `feature()` 的文件 | 逐步更新 import 路径 |
