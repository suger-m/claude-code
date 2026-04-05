# Provider Adapter 层 — 验证指南

## 改动概要

| 改动 | 文件 |
|------|------|
| 入口函数委托到 provider adapter | `src/services/api/claude.ts` |
| Provider 接口 + 5 种 adapter | `src/services/api/provider/` (8 文件) |
| Auth 接口 + 6 种 auth provider | `src/services/api/auth/` (8 文件) |
| 测试 | 22 个新增测试 |

## 1. 单元测试

```bash
# 全量测试（2129 pass, 0 fail）
bun test

# 仅 provider/auth 新增测试
bun test src/services/api/provider/__tests__/registry.test.ts
bun test src/services/api/auth/__tests__/providers.test.ts
```

预期：全部通过，无新增失败。

## 2. Anthropic 1P 验证（默认 provider）

```bash
# 需要 ANTHROPIC_API_KEY 已配置
bun run dev
```

交互操作：
1. 发送 `say hello` — 验证正常流式响应
2. 发送 `create a file called /tmp/test-provider.txt with content "hello"` — 验证 tool call 正常
3. 发送 `what is 2+2?` — 验证简单查询正常

预期行为与改动前完全一致。

## 3. OpenAI 兼容层验证

```bash
# 使用 Ollama 本地验证（需先启动 ollama serve）
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_BASE_URL=http://localhost:11434/v1 \
OPENAI_API_KEY=ollama \
OPENAI_MODEL=llama3 \
bun run dev
```

交互操作：
1. 发送 `say hello` — 验证 OpenAI adapter 路径正常工作
2. 验证流式输出正常逐字显示

## 4. Bedrock 验证（有 AWS 凭据时）

```bash
CLAUDE_CODE_USE_BEDROCK=1 \
AWS_REGION=us-east-1 \
bun run dev
```

交互操作：发送简单查询，验证 Bedrock adapter 正常响应。

## 5. Vertex 验证（有 GCP 凭据时）

```bash
CLAUDE_CODE_USE_VERTEX=1 \
ANTHROPIC_VERTEX_PROJECT_ID=your-project-id \
CLOUD_ML_REGION=us-east5 \
bun run dev
```

## 6. 代码结构验证

```bash
# 确认新文件存在
ls src/services/api/provider/
# 预期输出: anthropic.ts  bedrock.ts  foundry.ts  index.ts  openai.ts
#           registry.ts    types.ts    vertex.ts   __tests__/

ls src/services/api/auth/
# 预期输出: apiKey.ts  awsIam.ts  azureManaged.ts  gcpAdc.ts
#           index.ts   keychain.ts  oauth.ts  types.ts  __tests__/
```

## 7. Lint 检查

```bash
bun run lint
```

预期：新文件无新增 lint error（已有 error 为预存的，非本次引入）。

## 8. 构建验证

```bash
bun run build
```

预期：构建成功，产物可运行。

## 回归风险点

| 场景 | 验证方式 |
|------|---------|
| 流式响应中断 | 发送长对话，确认输出完整 |
| Tool call 丢失 | 请求创建/编辑文件，确认 tool 执行 |
| 中断/取消 | 查询过程中 Ctrl+C，确认无崩溃 |
| Token 计费 | 检查 cost tracker 输出是否正常显示 |

## 调用链路（改动后）

```
queryModelWithStreaming()        ← 外部入口
  → getProvider()                ← registry 返回对应 adapter
    → provider.queryStreaming()  ← adapter 内部调用 queryModel()

queryModelWithoutStreaming()     ← 外部入口
  → getProvider()
    → provider.query()           ← adapter 内部调用 queryModel()

queryModel()                     ← 内部实现（不直接暴露给外部）
```
