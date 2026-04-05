# Shell 执行层提取 — 验证指南

## 改动概要

将分散在 `src/utils/bash/`、`src/utils/shell/`、`src/utils/Shell.ts`、`src/utils/ShellCommand.ts`、`src/utils/subprocessEnv.ts` 中的 ~16,400 行 shell 相关代码提取为独立 `packages/shell` 包，通过依赖注入（`ShellExecContext`、`SnapshotContext`、`_deps.ts` setter）解耦与 `src/` 的依赖。

### 分阶段交付

| Phase | 范围 | 新增文件 | 行数 |
|-------|------|---------|------|
| P0 骨架 | 包结构、类型定义 | `package.json`, `types.ts`, `context.ts`, `_deps.ts` | ~200 |
| P1 Bash 解析器 | bash AST/tree-sitter、命令分割、heredoc、spec 注册表 | `bash/` 下 15 文件 + `prefix/specPrefix.ts` + `shell/prefix.ts` | ~11,800 |
| P1 验证/配置 | readOnlyCommandValidation, outputLimits, shellToolUtils, resolveDefaultShell | `providers/` 下 6 文件 | ~600 |
| P2 Provider | bashProvider, powershellProvider, ShellSnapshot | `providers/bashProvider.ts`, `providers/powershellProvider.ts`, `bash/ShellSnapshot.ts` | ~800 |
| P3 exec 核心 | subprocessEnv, ShellCommand, Shell 发现, exec() 入口 | `subprocessEnv.ts`, `shellCommand.ts`, `taskOutputPort.ts`, `shellDiscovery.ts`, `exec.ts` | ~1,173 |

### 依赖注入机制

```
                    ┌───────────────────────────────────────────┐
                    │           packages/shell                  │
                    │  (不直接 import src/ 的任何模块)            │
                    │                                           │
                    │  _deps.ts ←── setGetPlatformFn()          │
                    │           ←── setWhichFn()                │
                    │           ←── setWindowsPathToPosixPathFn()│
                    │           ←── setGenerateTaskIdFn()       │
                    │           ←── setPosixPathToWindowsPathFn()│
                    │                                           │
                    │  ShellExecContext ←── 接口由 src/ 实现     │
                    │  SnapshotContext  ←── 接口由 src/ 实现     │
                    │  setCreateTaskOutputFn() ←── 注入 TaskOutput│
                    │  setGetSandboxTmpDirNameFn() ←── 注入沙盒  │
                    └───────────────────────────────────────────┘
                              ↑ 仅通过接口交互
                    ┌───────────────────────────────────────────┐
                    │           src/ (消费者 + 适配器)            │
                    │  Shell.ts → 调用 exec(ctx, ...)           │
                    │  BashTool.tsx → 使用 ShellCommand 类型     │
                    │  hooks.ts → 使用 subprocessEnv()          │
                    └───────────────────────────────────────────┘
```

---

## 1. 单元测试

```bash
# 全量测试（预期 2271+ pass, 0 fail）
bun test

# 仅 packages/shell 导入验证（43 个测试）
bun test packages/shell/src/__test__/import.test.ts

# 原有 bash 解析器相关测试（确认未回归）
bun test src/utils/bash/__tests__/ 2>/dev/null
bun test src/tools/BashTool/__tests__/ 2>/dev/null
```

预期：全部通过，无新增失败。

## 2. 包独立性验证

```bash
# 确认 packages/shell 不 import src/ 中的任何模块
grep -rn "from ['\"]src/" packages/shell/src/ --include='*.ts'
# 预期：无输出

# 确认 packages/shell 不 import 相对路径超出包边界的模块
grep -rn "from ['\"]\.\./\.\./\.\./" packages/shell/src/ --include='*.ts'
# 预期：无输出

# 确认所有内部 import 在包内可解析
grep -rn "from '\.\." packages/shell/src/ --include='*.ts' | grep -v node_modules | head -20
# 预期：所有 import 路径指向 packages/shell/src/ 内的文件
```

## 3. 公共 API 导出完整性

```bash
# 列出 index.ts 的所有导出
bun -e "
const mod = require('./packages/shell/src/index.ts');
const exports = Object.keys(mod);
console.log('Export count:', exports.length);
const types = ['ShellType', 'ShellProvider', 'ShellConfig', 'ExecOptions', 'ExecResult',
  'ShellCommand', 'ShellExecContext', 'SnapshotContext', 'TaskOutputPort',
  'CommandSpec', 'Argument', 'Option', 'ParseEntry', 'ShellParseResult',
  'ShellQuoteResult', 'PowerShellEdition', 'FlagArgType', 'ExternalCommandConfig'];
// 值导出检查
const values = ['SHELL_TYPES', 'DEFAULT_HOOK_SHELL', 'quote', 'tryParseShellCommand',
  'tryQuoteShellArgs', 'hasMalformedTokens', 'parseCommand', 'ensureInitialized',
  'splitCommand_DEPRECATED', 'splitCommandWithOperators', 'isHelpCommand',
  'extractHeredocs', 'restoreHeredocs', 'containsHeredoc', 'getCommandSpec',
  'analyzeCommand', 'createBashShellProvider', 'createPowerShellProvider',
  'buildPowerShellArgs', 'createAndSaveSnapshot', 'subprocessEnv',
  'wrapSpawn', 'createAbortedCommand', 'createFailedCommand',
  'findSuitableShell', 'exec', 'setCwd', 'GIT_READ_ONLY_COMMANDS',
  'validateFlags', 'FLAG_PATTERN', 'getMaxOutputLength', 'SHELL_TOOL_NAMES'];
let missing = values.filter(v => !(v in mod));
if (missing.length) console.log('Missing exports:', missing);
else console.log('All expected value exports present');
"
```

预期：`All expected value exports present`。

## 4. 功能性 Smoke Test

```bash
bun -e "
const {
  quote, tryParseShellCommand, tryQuoteShellArgs, quoteShellCommand,
  splitCommand_DEPRECATED, splitCommandWithOperators, isHelpCommand,
  containsHeredoc, shouldAddStdinRedirect, getMaxOutputLength,
  validateFlags, getCommandSpec, buildPrefix,
  createAbortedCommand, createFailedCommand, buildPowerShellArgs,
  subprocessEnv, rearrangePipeCommand,
} = require('./packages/shell/src/index.ts');

// bash 解析层
console.assert(typeof quote(['echo', 'hello']) === 'string', 'quote');
const parsed = tryParseShellCommand('echo hello');
console.assert(parsed.success === true, 'tryParseShellCommand');
const quoted = tryQuoteShellArgs(['echo', 'hello world']);
console.assert(quoted.success === true, 'tryQuoteShellArgs');
console.assert(typeof quoteShellCommand('echo hi') === 'string', 'quoteShellCommand');
console.assert(rearrangePipeCommand('echo hi | cat') !== undefined, 'rearrangePipeCommand');

// 命令分析
console.assert(splitCommand_DEPRECATED('echo hello').length > 0, 'split');
console.assert(splitCommandWithOperators('a && b').length > 0, 'splitWithOps');
console.assert(isHelpCommand('git --help') === true, 'isHelp');
console.assert(isHelpCommand('git status') === false, 'isHelp2');
console.assert(containsHeredoc('echo hello') === false, 'heredoc');
console.assert(typeof shouldAddStdinRedirect('echo hi') === 'boolean', 'stdinRedirect');

// 验证/配置
console.assert(typeof getMaxOutputLength() === 'number', 'maxOutput');
console.assert(validateFlags.length >= 3, 'validateFlags');
console.assert(typeof subprocessEnv() === 'object', 'subprocessEnv');
console.assert('PATH' in subprocessEnv(), 'subprocessEnv has PATH');

// ShellCommand 工厂
const aborted = createAbortedCommand();
console.assert(aborted.status === 'killed', 'aborted');
const failed = createFailedCommand('test error');
console.assert(failed.status === 'completed', 'failed');

// PowerShell
console.assert(
  JSON.stringify(buildPowerShellArgs('echo hi')) ===
  JSON.stringify(['-NoProfile','-NonInteractive','-Command','echo hi']),
  'psArgs'
);

// 异步测试
(async () => {
  const spec = await getCommandSpec('nonexistent_xyz');
  console.assert(spec === null, 'spec null');
  const pfx = await buildPrefix('echo', ['hello'], null);
  console.assert(typeof pfx === 'string', 'prefix');
  console.log('ALL SMOKE TESTS PASSED');
})();
"
```

预期：`ALL SMOKE TESTS PASSED`。

## 5. 依赖注入桥接验证

```bash
# 确认 _deps.ts setter 存在且可调用
bun -e "
const { setGetPlatformFn, setWhichFn, setWindowsPathToPosixPathFn,
        setPosixPathToWindowsPathFn, setGenerateTaskIdFn } = require('./packages/shell/src/_deps.js');
console.assert(typeof setGetPlatformFn === 'function', 'setGetPlatformFn');
console.assert(typeof setWhichFn === 'function', 'setWhichFn');
console.assert(typeof setWindowsPathToPosixPathFn === 'function', 'setWinToPosix');
console.assert(typeof setPosixPathToWindowsPathFn === 'function', 'setPosixToWin');
console.assert(typeof setGenerateTaskIdFn === 'function', 'setGenTaskId');
console.log('ALL INJECTION SETTERS VERIFIED');
"
```

预期：`ALL INJECTION SETTERS VERIFIED`。

## 6. Tree-sitter 解析验证

```bash
bun -e "
const { parseCommand, ensureInitialized, extractCommandArguments, PARSE_ABORTED } = require('./packages/shell/src/index.ts');

// 确保 parser 初始化后可用
ensureInitialized().then(() => {
  const result = parseCommand('echo hello world');
  if (result === PARSE_ABORTED) {
    console.log('PARSE_ABORTED (WASM not available in this env — acceptable)');
    return;
  }
  const args = extractCommandArguments(result);
  console.assert(args.length >= 2, 'extractArgs');
  console.log('Tree-sitter parsing OK, args:', args);
});
"
```

预期：在 WASM 可用的环境下输出 `Tree-sitter parsing OK`；在纯 Bun 环境下可能输出 `PARSE_ABORTED`（可接受）。

## 7. Lint 检查

```bash
bun run lint
```

预期：新文件无新增 lint error（已有 error 为预存的 decompiled 代码残留，非本次引入）。

## 8. 构建验证

```bash
bun run build
```

预期：构建成功，产物中包含 `packages/shell` 的代码。

## 9. 交互式 REPL 验证

```bash
bun run dev
```

交互操作：
1. 发送 `echo "Hello from Claude"` — 验证 Bash 工具基本执行
2. 发送 `pwd` — 验证 CWD 追踪正常
3. 发送 `cd /tmp && pwd` — 验证 CWD 变更检测正常
4. 发送 `echo "test heredoc" > /tmp/test-shell-migration.txt && cat /tmp/test-shell-migration.txt` — 验证文件重定向
5. 发送 `ls /nonexistent_path 2>&1` — 验证 stderr 捕获正常
6. 发送 `for i in 1 2 3; do echo $i; done` — 验证复合命令

预期：所有操作行为与改动前完全一致。

## 10. 沙盒模式验证（如有权限）

```bash
FEATURE_SANDBOX=1 bun run dev
```

交互操作：
1. 发送 `touch /tmp/sandbox-test.txt` — 验证沙盒内文件创建
2. 发送 `cat /etc/passwd | head -1` — 验证沙盒内读取正常

预期：沙盒隔离行为与改动前一致。

---

## 回归风险点

| 场景 | 风险 | 验证方式 |
|------|------|---------|
| Bash 命令执行失败 | **高** — 核心功能 | `bun run dev` 中执行 `echo hello` |
| CWD 追踪丢失 | **高** — 目录切换不生效 | `cd /tmp && pwd` 后确认 cwd 变化 |
| Tree-sitter WASM 加载失败 | **高** — AST 分析不可用 | §6 tree-sitter 验证 |
| Shell 环境快照损坏 | **中** — PATH/env 缺失 | 启动时 snapshot 日志，执行 `which node` |
| PowerShell 路径检测失败 | **中** — Windows 不可用 | Windows 上执行 PowerShell 命令 |
| subprocessEnv 秘密泄漏 | **中** — 安全风险 | 设置 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`，执行 `echo $ANTHROPIC_API_KEY`（应输出空） |
| Hook 执行环境错误 | **中** — hook 命令失败 | 配置 PreToolUse hook，验证触发 |
| 命令超时/中断 | **中** — 长命令无法终止 | 执行 `sleep 1000`，然后中断 |
| 沙盒隔离绕过 | **中** — 安全风险 | 沙盒内尝试写入禁止路径 |
| 背景任务丢失 | **低** — 长时间运行任务 | 执行长时间命令后 Ctrl+Z 背景化 |

---

## 调用链路（改动后）

```
消费者 (src/)                           packages/shell
─────────────────                       ──────────────────────────
BashTool.tsx
  → exec(cmd, signal, 'bash', ctx)  →  exec.ts
    → getProviderResolver(ctx)       →  shellDiscovery.ts
      → createBashShellProvider(ctx) →  providers/bashProvider.ts
        → ShellSnapshot              →  bash/ShellSnapshot.ts
        → shellQuote, shellQuoting   →  bash/shellQuote.ts, shellQuoting.ts
    → wrapSpawn(...)                 →  shellCommand.ts
    → subprocessEnv()                →  subprocessEnv.ts
    → setCwd(ctx, path)              →  exec.ts

PowerShellTool.tsx
  → exec(cmd, signal, 'powershell', ctx) →  exec.ts
    → createPowerShellProvider(ctx)  →  providers/powershellProvider.ts

hooks.ts
  → subprocessEnv()                  →  subprocessEnv.ts

BashTool 安全检查
  → parseCommand(cmd)                →  bash/parser.ts
  → splitCommandWithOperators(cmd)   →  bash/commands.ts
  → analyzeCommand(cmd)              →  bash/treeSitterAnalysis.ts
```

## 后续迁移路线

当前 `src/utils/Shell.ts` 仍为原始实现，尚未切换到 packages/shell 的 exec()。后续步骤：

1. **适配器层**：在 `src/` 中创建 `shellBridge.ts`，实现 `ShellExecContext` 接口，桥接 src/ 侧的实际实现
2. **消费方切换**：将 `src/utils/Shell.ts` 的 `exec()` 改为调用 `packages/shell` 的 `exec()`
3. **re-export 层**：在 `src/utils/bash/` 和 `src/utils/shell/` 创建 index.ts re-export
4. **逐步替换**：30+ 消费文件的 import 路径逐个迁移到 `@anthropic/shell`
5. **清理**：删除原始文件或改为纯 re-export
