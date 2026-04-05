# 自动更新/安装器 - 实施计划

> 基于设计文档 `design.md` 和代码库实际调查结果

## 一、总体概述

设计文档的目标是将散布在 `src/utils/` 中的更新相关代码（约 3579 行）提取为独立 package `packages/updater`，仅被 entry layer（`cli.tsx` / `main.tsx`）调用。

经过代码库调查，当前更新系统实际上已经是一个功能完整、跨平台支持丰富的子系统，涉及约 **4867 行代码**（含 UI 组件），分布在 12 个主要文件中。与设计文档中 "~3579 行" 的估算有出入，因为设计文档未计入 UI 层和 CLI 命令层代码。

## 二、模块清单与当前状态

### 2.1 核心逻辑层（`src/utils/`）

| 文件 | 行数 | 当前状态 | 说明 |
|------|------|----------|------|
| `src/utils/autoUpdater.ts` | 561 | **已完整实现** | npm/js 自动更新核心：版本检查（npm registry + GCS）、全局/本地包安装、PID 锁、minVersion/maxVersion 门控、版本历史查询 |
| `src/utils/localInstaller.ts` | 162 | **已完整实现** | 本地安装器：`~/.claude/local/` 目录下的 npm 包管理，package.json 环境初始化 |
| `src/utils/lockfile.ts` | ~100 | **已完整实现** | 基于 proper-lockfile 的 mtime 锁机制（被 nativeInstaller 引用） |

### 2.2 Native 安装器层（`src/utils/nativeInstaller/`）

| 文件 | 行数 | 当前状态 | 说明 |
|------|------|----------|------|
| `index.ts` | 18 | **已完整实现** | Barrel file，导出公开 API |
| `installer.ts` | 1708 | **已完整实现** | 核心安装器：版本管理、symlink 更新、旧版本清理（保留 2 个）、npm 安装清理、shell alias 清理、atomic 文件操作、Windows 文件复制策略 |
| `download.ts` | 523 | **已完整实现** | 二进制下载：Artifactory（ant）/ GCS（外部用户）双通道、SHA256 校验、60s stall 检测、3 次重试、manifest 解析 |
| `pidLock.ts` | 433 | **已完整实现** | PID 锁系统：进程存活检测、Claude 进程验证、PID 重用防护、legacy proper-lockfile 兼容、stale lock 清理 |
| `packageManagers.ts` | 336 | **已完整实现** | 包管理器检测：Homebrew、winget、pacman、deb、rpm、apk、mise、asdf，含 /etc/os-release distro family 匹配 |
| `src/services/analytics/index.ts` (子目录副本) | 3 | **Stub** | 类型存根，导出 `any` 类型 |

### 2.3 CLI 命令层

| 文件 | 行数 | 当前状态 | 说明 |
|------|------|----------|------|
| `src/cli/update.ts` | 422 | **已完整实现** | `claude update` / `claude upgrade` 命令：诊断 -> 安装类型检测 -> 策略路由 |
| `src/commands/install.tsx` | ~100 | **已完整实现** | `claude install` 命令 UI 组件（React/Ink 渲染） |
| `src/cli/rollback.ts` | ~50 | **已完整实现（ant-only）** | `claude rollback` 命令，feature-gated by `USER_TYPE === 'ant'` |

### 2.4 UI 组件层（`src/components/`）

| 文件 | 行数 | 当前状态 | 说明 |
|------|------|----------|------|
| `AutoUpdaterWrapper.tsx` | 90 | **已完整实现** | 策略路由器：检测安装类型 -> 选择对应的更新组件 |
| `AutoUpdater.tsx` | 264 | **已完整实现** | npm/js 后台自动更新器：30 分钟轮询，后台静默安装 |
| `NativeAutoUpdater.tsx` | 231 | **已完整实现** | Native 二进制后台自动更新器：30 分钟轮询，错误分类上报 |
| `PackageManagerAutoUpdater.tsx` | 119 | **已完整实现** | 包管理器通知器：30 分钟轮询，仅显示升级命令不自动安装 |

### 2.5 辅助模块

| 文件 | 行数 | 当前状态 | 说明 |
|------|------|----------|------|
| `src/hooks/useUpdateNotification.ts` | ~30 | **已完整实现** | React hook，按 semver 去重更新通知 |
| `src/utils/releaseNotes.ts` | ~100 | **已完整实现** | Changelog 获取、缓存（`~/.claude/cache/changelog.md`）与展示 |
| `src/migrations/migrateAutoUpdatesToSettings.ts` | 61 | **已完整实现** | 一次性迁移：旧版 `globalConfig.autoUpdates` -> settings.json env var |
| `src/utils/semver.ts` | ~80 | **已完整实现** | 版本比较：Bun 原生 + npm semver 回退 |
| `src/utils/doctorDiagnostic.ts` | ~200 | **已完整实现** | 安装类型检测与健康诊断 |

## 三、需要做的具体工作

### 阶段 1：创建 `packages/updater` 包结构

**优先级：P0（基础）**

创建独立 package 目录，建立标准的 monorepo 包结构：

```
packages/updater/
├── package.json          # workspace:* 依赖配置
├── tsconfig.json         # 继承根配置
└── src/
    ├── index.ts          # 公开 API 导出
    ├── autoUpdater.ts    # 从 src/utils/autoUpdater.ts 迁移
    ├── localInstaller.ts # 从 src/utils/localInstaller.ts 迁移
    ├── nativeInstaller/
    │   ├── index.ts
    │   ├── installer.ts
    │   ├── download.ts
    │   ├── pidLock.ts
    │   └── packageManagers.ts
    ├── types.ts          # 共享类型定义
    └── __tests__/        # 单元测试
```

**具体任务：**
1. 创建 `packages/updater/package.json`，声明 `workspace:*` 依赖
2. 创建 `packages/updater/tsconfig.json`，继承根配置
3. 将 `src/utils/autoUpdater.ts` 迁移到 `packages/updater/src/autoUpdater.ts`
4. 将 `src/utils/localInstaller.ts` 迁移到 `packages/updater/src/localInstaller.ts`
5. 将 `src/utils/nativeInstaller/` 整个目录迁移到 `packages/updater/src/nativeInstaller/`
6. 创建 `packages/updater/src/index.ts` 作为统一导出入口
7. 更新根 `package.json` 的 workspaces 配置

**风险：**
- 导入路径变更会引发大量 tsc 错误（但现有代码已有 ~1341 个 tsc 错误，不影响运行时）
- `nativeInstaller/src/services/analytics/index.ts` 的 stub 需要替换为正确的 import 路径

### 阶段 2：处理外部依赖

**优先级：P0（紧随阶段 1）**

updater 模块依赖的内部模块需要通过明确的包依赖关系引入：

| 依赖来源 | 当前 import 路径 | 处理方式 |
|----------|-----------------|----------|
| analytics | `src/services/analytics/` | 保留 import（共享服务）或抽象为接口注入 |
| config | `src/utils/config.ts` | 保留 import 或提取 config 接口 |
| debug | `src/utils/debug.ts` | 保留 import |
| errors | `src/utils/errors.ts` | 保留 import |
| execFileNoThrow | `src/utils/execFileNoThrow.ts` | 保留 import |
| fsOperations | `src/utils/fsOperations.ts` | 保留 import |
| lockfile | `src/utils/lockfile.ts` | 迁移到 updater 包内（只有 updater 使用） |
| semver | `src/utils/semver.ts` | 保留 import（多处共用） |
| settings | `src/utils/settings/settings.ts` | 保留 import |
| shellConfig | `src/utils/shellConfig.ts` | 保留 import |
| xdg | `src/utils/xdg.ts` | 保留 import |
| slowOperations | `src/utils/slowOperations.ts` | 保留 import |
| env/envUtils | `src/utils/env.ts`, `envUtils.ts` | 保留 import |
| platform | `src/utils/platform.ts` | 保留 import |
| cleanupRegistry | `src/utils/cleanupRegistry.ts` | 保留 import |

**具体任务：**
1. 梳理所有 import 依赖图，确认边界
2. 将 `src/utils/lockfile.ts` 迁移到 `packages/updater/src/` 内（它是 updater 独有的）
3. 对于共享依赖（analytics、config、semver 等），保持 `src/` 路径 import 不变
4. 删除 `src/utils/nativeInstaller/src/services/analytics/index.ts` 这个 stub，改为直接 import

**风险：**
- 共享依赖多，完全解耦工作量巨大。建议**保留对 `src/` 的 import**，仅做物理文件位置迁移
- 设计文档说"无业务依赖"，但实际上 updater 依赖了大量 `src/utils/` 工具函数

### 阶段 3：更新调用方的 import 路径

**优先级：P1**

需要更新所有引用了迁移模块的文件：

| 需更新的文件 | 当前 import |
|-------------|-------------|
| `src/cli/update.ts` | `src/utils/autoUpdater.js`, `src/utils/localInstaller.js`, `src/utils/nativeInstaller/index.js` |
| `src/components/AutoUpdater.tsx` | `../utils/autoUpdater.js`, `../utils/localInstaller.js`, `../utils/nativeInstaller/index.js` |
| `src/components/AutoUpdaterWrapper.tsx` | `../utils/autoUpdater.js` (间接) |
| `src/components/NativeAutoUpdater.tsx` | `../utils/autoUpdater.js`, `../utils/nativeInstaller/index.js` |
| `src/components/PackageManagerAutoUpdater.tsx` | `../utils/autoUpdater.js`, `../utils/nativeInstaller/packageManagers.js` |
| `src/commands/install.tsx` | `../utils/nativeInstaller/index.js` |
| `src/main.tsx` | `src/cli/update.js`（间接，通过 dynamic import） |
| `src/setup.ts` | `src/utils/autoUpdater.js` (assertMinVersion) |
| `src/screens/Doctor.tsx` | autoUpdater/nativeInstaller 相关 |
| `src/utils/backgroundHousekeeping.ts` | 可能引用 |
| `src/utils/doctorDiagnostic.ts` | 引用 nativeInstaller |

**具体任务：**
1. 全局搜索替换 import 路径
2. 确保 Bun 的 `bun:bundle` import（`feature()`）在包内仍正常工作
3. 验证 `MACRO.VERSION`、`MACRO.PACKAGE_URL`、`MACRO.NATIVE_PACKAGE_URL` 等 define 在新路径下仍然可用

**风险：**
- import 路径变更可能遗漏某些间接引用
- `MACRO.*` defines 是通过 Bun build/dev 注入的，包内的代码能否正确访问需要验证

### 阶段 4：UI 组件处理

**优先级：P2**

设计文档仅提及逻辑层提取（~3579 行），但 UI 组件（~704 行）也需要决定归属：

**方案 A（推荐）：UI 组件留在 `src/components/`**
- UI 组件依赖 Ink 框架（React），与逻辑层性质不同
- 保持 `AutoUpdaterWrapper.tsx` 等组件在原位，仅更新其内部 import 路径
- 符合设计文档"仅被 entry layer 调用"的原则

**方案 B：UI 组件也迁移到 `packages/updater/`**
- 需要将 updater 包变成包含 React/Ink 组件的包
- 增加了包的复杂度和依赖

**具体任务（方案 A）：**
1. `src/components/AutoUpdater*.tsx` 保持原位
2. 仅更新这些组件内部对 `src/utils/autoUpdater` 和 `src/utils/nativeInstaller` 的 import 路径指向新包

### 阶段 5：测试迁移与补充

**优先级：P2**

| 任务 | 说明 |
|------|------|
| 迁移现有测试 | 如果 `src/utils/autoUpdater` 或 `src/utils/nativeInstaller` 下有现有测试，需要迁移 |
| 补充单元测试 | 为 `pidLock.ts`、`download.ts`、`packageManagers.ts` 补充测试 |
| 集成测试 | 验证完整更新流程（mock 下载和安装） |

### 阶段 6：清理与验证

**优先级：P3**

1. 删除 `src/utils/autoUpdater.ts`（已迁移）
2. 删除 `src/utils/localInstaller.ts`（已迁移）
3. 删除 `src/utils/nativeInstaller/` 目录（已迁移）
4. 运行 `bun test` 确保所有测试通过
5. 运行 `bun run build` 确保构建正常
6. 运行 `bun run health` 进行健康检查

## 四、依赖关系图

```
src/main.tsx ─────────────────────────────────┐
  ├── src/cli/update.ts ──────────────────────┤
  │     └── packages/updater (autoUpdater,   │
  │         localInstaller, nativeInstaller)  │
  │                                           │
  └── src/setup.ts ──────────────────────────┤
        └── packages/updater (assertMinVersion)│
                                               │
src/components/ ───────────────────────────────┤
  ├── AutoUpdaterWrapper.tsx                  │
  ├── AutoUpdater.tsx ─── packages/updater     │
  ├── NativeAutoUpdater.tsx ─ packages/updater │
  └── PackageManagerAutoUpdater.tsx            │
        └── packages/updater                   │
                                               │
src/commands/install.tsx ─ packages/updater ───┘
src/screens/Doctor.tsx ─── packages/updater
src/migrations/migrateAutoUpdatesToSettings.ts ─ packages/updater (间接)
```

## 五、关键风险与难点

### 5.1 高风险

1. **MACRO defines 的穿透性**：`MACRO.VERSION`、`MACRO.PACKAGE_URL`、`MACRO.NATIVE_PACKAGE_URL` 等 define 是通过 Bun build 和 dev 脚本注入的。迁移到 `packages/` 后，这些 define 是否仍然在包内的文件中生效需要验证。如果不行，需要将这些值作为函数参数传入。

2. **`feature()` 调用**：`src/utils/nativeInstaller/download.ts` 使用了 `import { feature } from 'bun:bundle'`。monorepo workspace 包中的代码能否访问 `bun:bundle` 需要验证。

3. **`process.env.USER_TYPE` 硬编码**：多处代码直接读取 `process.env.USER_TYPE` 区分 ant/external 用户。迁移不应改变此行为，但需确认环境变量在包内可访问。

### 5.2 中风险

4. **共享依赖的耦合度**：updater 依赖了约 15 个 `src/utils/` 工具模块。完全解耦不现实，保留 `src/` import 可能导致循环依赖或路径解析问题。

5. **文件锁机制的跨平台兼容性**：`pidLock.ts` 使用 `process.kill(pid, 0)` 检测进程状态，Windows 上行为可能不同。迁移不应引入新的兼容性问题。

6. **Build 产物的 chunk 拆分**：`build.ts` 使用 `splitting: true`，新增 `packages/updater` 会影响 chunk 布局。需要验证构建产物大小和加载性能不受影响。

### 5.3 低风险

7. **Analytics 事件名**：所有 `tengu_*` 前缀的事件名应保持不变，迁移不应改变遥测数据。

8. **Lockfile 兼容性**：`src/utils/lockfile.ts` 如果迁移到 updater 包内，需确认 proper-lockfile 的 npm 包依赖正确声明。

## 六、预估工作量

| 阶段 | 工作量 | 说明 |
|------|--------|------|
| 阶段 1：创建包结构 | 2-3 小时 | 文件迁移 + package.json 配置 |
| 阶段 2：处理依赖 | 2-4 小时 | 依赖梳理 + lockfile 迁移 |
| 阶段 3：更新 import | 1-2 小时 | 全局搜索替换 |
| 阶段 4：UI 组件 | 0.5-1 小时 | 仅更新 import 路径 |
| 阶段 5：测试 | 2-4 小时 | 迁移 + 补充测试 |
| 阶段 6：清理验证 | 1-2 小时 | 删除旧文件 + 构建验证 |
| **总计** | **9-16 小时** | |

## 七、与设计文档的差异分析

| 设计文档描述 | 实际情况 | 差异 |
|-------------|----------|------|
| 总计约 3579 行 | 实际约 4867 行（含 UI + CLI 命令层） | 设计文档未计入 UI 组件和 CLI 命令代码 |
| "nativeInstaller/(5文件 3018行)" | nativeInstaller/ 有 5 文件 + 1 stub = 3018 行 | 基本吻合 |
| "autoUpdater.ts(561行)" | autoUpdater.ts 确认 561 行 | 吻合 |
| "散布在 utils/ 中" | 确认在 `src/utils/` 下，但 UI 组件在 `src/components/` | UI 组件也需要处理 |
| "提取为独立 package" | `packages/updater/` 目录当前不存在 | 需要从零创建 |
| "仅被 entry layer 调用; 无业务依赖" | 实际上被 UI 组件、commands、migrations 等多处引用，且有 ~15 个 src/ 内部依赖 | 依赖关系比设计文档描述的更复杂 |

## 八、建议的执行顺序

1. **先验证 MACRO defines**：创建一个最简的 `packages/updater/` 包，放一个使用 `MACRO.VERSION` 的文件，运行 `bun run dev` 验证 define 注入是否工作。如果不工作，需要调整 build/dev 脚本。
2. **执行阶段 1**：迁移核心逻辑文件（不含 UI 组件）。
3. **执行阶段 2-3**：处理依赖和 import 路径。
4. **执行阶段 4-5**：UI 适配和测试。
5. **执行阶段 6**：清理和最终验证。
