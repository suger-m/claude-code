# Command System 实现计划

> 基于 `design.md` 设计文档与代码库实际调查结果

## 当前状态总览

命令系统在代码库中**已基本完整实现**。设计文档中描述的所有核心流程、模块、数据结构均已存在且功能完备。以下按模块逐项说明状态。

---

## 模块清单与当前状态

### 1. 命令类型定义 (`src/types/command.ts`)

- **当前状态**: 已实现
- **说明**: 定义了 `Command` 联合类型（`PromptCommand | LocalCommand | LocalJSXCommand`），以及 `CommandBase`、`CommandAvailability`、`LocalCommandResult`、`LocalJSXCommandContext` 等核心类型。包含 `getCommandName()` 和 `isCommandEnabled()` 工具函数。
- **工作量**: 无需额外工作

### 2. 命令注册中心 (`src/commands.ts`, ~754 行)

- **当前状态**: 已实现
- **说明**:
  - `COMMANDS()` 函数通过 memoize 静态注册所有内建命令（~96 个）
  - 支持条件导入（feature flag 控制 proactive、bridge、voice 等）
  - `INTERNAL_ONLY_COMMANDS` 列表区分内外部命令
  - `getCommands()` 异步合并所有命令源（内建 + 动态 skill + 插件 + workflow）
  - `findCommand()` / `getCommand()` / `hasCommand()` 提供查找能力
  - `REMOTE_SAFE_COMMANDS` / `BRIDGE_SAFE_COMMANDS` 硬编码安全列表
  - `getSkillToolCommands()` / `getSlashCommandToolSkills()` 提供 SkillTool 专用过滤
  - `meetsAvailabilityRequirement()` 过滤 auth/provider 可见性
  - 缓存管理：`clearCommandsCache()` / `clearCommandMemoizationCaches()`
- **耦合特征**（与设计文档一致）: 静态导入所有命令文件，新增命令必须手动在此文件注册
- **工作量**: 无需额外工作

### 3. 命令实现目录 (`src/commands/`, 108 个条目)

- **当前状态**: 已实现
- **说明**: 每个命令是独立目录（或单文件），导出一个满足 `Command` 类型的对象。三种类型均有实例：
  - `local`: 如 `clear`、`compact`、`exit` -- 返回 `LocalCommandResult`
  - `local-jsx`: 如 `help`、`config`、`model`、`btw` -- 渲染 Ink UI 组件
  - `prompt`: 由 skill 系统动态生成，无独立目录（见下方 skill 加载）
- **工作量**: 无需额外工作

### 4. 斜杠命令解析 (`src/utils/slashCommandParsing.ts`)

- **当前状态**: 已实现
- **说明**: `parseSlashCommand()` 解析 `/command-name [args]` 格式，支持 MCP 命令（`/mcp:tool (MCP) args`），返回 `ParsedSlashCommand`。
- **工作量**: 无需额外工作

### 5. 命令分发器 (`src/utils/processUserInput/processSlashCommand.tsx`, ~1262 行)

- **当前状态**: 已实现
- **说明**:
  - `processSlashCommand()` 入口函数：解析命令名 -> `getCommand()` 查找 -> `getMessagesForSlashCommand()` 分发
  - `getMessagesForSlashCommand()` 使用 `switch(command.type)` 分发到三条路径：
    - `local-jsx`: 调用 `load()` -> `call()` -> 返回 ReactNode，通过 `setToolJSX` 渲染
    - `local`: 调用 `load()` -> `call()` -> 返回 `LocalCommandResult`（text/compact/skip）
    - `prompt`: 支持 inline 和 fork 两种执行模式
  - `executeForkedSlashCommand()` 实现子代理执行，支持 KAIROS 后台模式
  - `getMessagesForPromptSlashCommand()` 处理 prompt 类型命令，包括 skill hooks 注册、attachment 提取、coordinator 模式摘要
  - 完整的错误处理、telemetry、权限检查
- **耦合特征**（与设计文档一致）: switch 分发，新命令类型需修改此文件
- **工作量**: 无需额外工作

### 6. 用户输入处理 (`src/utils/processUserInput/processUserInput.ts`, ~605 行)

- **当前状态**: 已实现
- **说明**:
  - `processUserInput()` 顶层入口，处理多种输入模式（prompt/bash/slash command）
  - 识别 `/` 前缀路由到 `processSlashCommand()`
  - 支持 bridge 安全检查、ultraplan 关键词路由、attachment 提取
  - `processUserInputBase()` 处理图片粘贴、IDE selection 等
- **工作量**: 无需额外工作

### 7. Prompt 提交处理 (`src/utils/handlePromptSubmit.ts`, ~610 行)

- **当前状态**: 已实现
- **说明**: 连接 REPL UI 与 `processUserInput()` 的桥梁，管理消息队列、文件快照、workload 上下文、abort controller 等。
- **工作量**: 无需额外工作

### 8. 自动补全 (`src/hooks/useTypeahead.tsx`, ~1881 行)

- **当前状态**: 已实现
- **说明**:
  - 输入 `/` 触发 `generateCommandSuggestions()`
  - 支持 Ghost Text 补全、列表选择、Tab/Enter 确认
  - 集成多种补全源：命令、文件路径、bash 历史、Slack 频道、目录
  - `generateUnifiedSuggestions()` 统一调度
- **工作量**: 无需额外工作

### 9. 命令建议 (`src/utils/suggestions/commandSuggestions.ts`, ~567 行)

- **当前状态**: 已实现
- **说明**:
  - `generateCommandSuggestions()` 基于 Fuse.js 模糊搜索
  - 排序优先级：精确 > alias > 前缀 > 模糊
  - 按来源分组（recently used / builtin / user / project / policy / other）
  - `applyCommandSuggestion()` 应用选中建议到输入框
  - `getBestCommandMatch()` 获取最佳内联补全
  - `findSlashCommandPositions()` 高亮文本中的斜杠命令
- **工作量**: 无需额外工作

### 10. Skill 加载系统 (`src/skills/loadSkillsDir.ts`, ~1087 行)

- **当前状态**: 已实现
- **说明**:
  - `getSkillDirCommands()` 从多个源加载 skill：managed、user、project、additional、legacy commands
  - 支持两种目录格式：`/skills/name/SKILL.md`（推荐）和 `/commands/name.md`（已弃用）
  - Frontmatter 解析：description、allowed-tools、arguments、model、effort、hooks、context、agent、paths 等
  - 动态 skill 发现：`discoverSkillDirsForPaths()` 文件操作时自动发现嵌套 skill 目录
  - 条件 skill：`activateConditionalSkillsForPaths()` 基于 paths frontmatter 按文件路径激活
  - 完整的去重机制（基于 realpath）
  - `registerMCPSkillBuilders()` 注册到 MCP skill 构建
- **工作量**: 无需额外工作

### 11. 内置 Skill 注册 (`src/skills/bundledSkills.ts`, ~221 行)

- **当前状态**: 已实现
- **说明**: `registerBundledSkill()` API 允许模块化注册编译时内置 skill，支持文件提取到临时目录。
- **工作量**: 无需额外工作

### 12. SkillTool (`src/tools/SkillTool/SkillTool.ts`)

- **当前状态**: 已实现
- **说明**: 模型通过 Skill tool 直接调用 prompt 类型命令的第二条路径。设计文档中提到的"第二条路径"已完整实现。
- **工作量**: 无需额外工作

---

## 架构评价与潜在改进点

设计文档中标注的**耦合特征**确实存在，但在当前阶段不构成问题：

1. **`commands.ts` 静态注册** -- 新增内建命令仍需手动在 `COMMANDS()` 数组中添加条目。但动态 skill（`.claude/skills/`、插件、workflow）无需改动此文件。
2. **`processSlashCommand.tsx` switch 分发** -- 三种命令类型（local/local-jsx/prompt）的分发逻辑固定在 switch 中。新增命令类型需修改此处，但当前三种类型已覆盖所有场景。
3. **安全命令列表硬编码** -- `REMOTE_SAFE_COMMANDS` 和 `BRIDGE_SAFE_COMMANDS` 是手动维护的 Set，新增安全命令需手动添加。

以上耦合点在可预见的未来不太可能成为瓶颈，因为：
- 大部分新增能力通过 `prompt` 类型 skill 实现，不需要改内建命令
- 三种命令类型已覆盖所有执行模式
- 安全列表变更频率很低

---

## 如果需要扩展的工作计划

以下按优先级排序，列出假设要进一步改进/扩展命令系统时的任务。

### P0 -- 维持现有功能正常

无待办事项。所有核心功能已实现且运行正常。

### P1 -- 降低耦合度（可选重构）

| 任务 | 说明 | 风险 |
|------|------|------|
| 命令自动注册 | 将 `COMMANDS()` 中的静态 import 列表改为自动扫描 `src/commands/` 目录 | 中 -- 改动面大，可能影响 tree-shaking 和死代码消除 |
| 分发器策略模式 | 将 `processSlashCommand.tsx` 中的 switch 替换为注册式策略模式 | 低 -- 但当前三种类型足够，投入产出比不高 |

### P2 -- 开发者体验优化

| 任务 | 说明 | 风险 |
|------|------|------|
| 命令脚手架工具 | 提供 `bun run create-command <name> <type>` 脚本自动生成目录和模板 | 低 |
| 命令类型文档 | 为三种命令类型（local/local-jsx/prompt）补充开发指南 | 无 |
| 安全命令 lint | 编写 lint 规则检测新增 `local` 类型命令是否在安全列表中 | 低 |

### P3 -- 高级特性

| 任务 | 说明 | 风险 |
|------|------|------|
| 命令权限模型统一 | 将安全命令列表从硬编码改为命令定义中的声明式标记（如 `bridgeSafe: true`） | 中 -- 需要审计所有现有命令 |
| 命令生命周期钩子 | 为命令执行添加 `beforeCall` / `afterCall` 钩子（当前仅 prompt 类型有 hooks） | 低 |

---

## 风险与难点

1. **Tree-shaking 敏感性**: `commands.ts` 中的条件 `require()` 设计是为了配合构建工具的死代码消除。改为动态扫描可能破坏这一优化。
2. **缓存一致性**: `getCommands()` 使用多层 memoize（loadAllCommands -> getSkills -> getSkillDirCommands），任何一层缓存失效都需正确传播。当前通过 `clearCommandsCache()` 统一管理。
3. **Skill 去重**: 基于 `realpath` 的去重依赖文件系统行为，在 NFS/容器环境中可能有边缘情况。
4. **Bridge 安全边界**: Remote Control 模式下的命令安全是安全敏感区域，修改需格外谨慎。

---

## 结论

命令系统是一个**已完成**的功能模块。设计文档描述的所有组件均已实现，代码结构清晰，功能完备。无需额外的实现计划，除非有明确的重构需求。
