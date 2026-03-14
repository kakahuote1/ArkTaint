# LLM 规则生成实现指南

## 快速开始

```bash
# 1. 分析项目，生成 summary.json
node out/cli/analyze.js --repo ./tests --outputDir tmp/analyze/out --profile fast

# 2. 使用 Mock 模式测试（无需 API Key）
npm run llm:generate:mock -- tmp/analyze/out/summary.json

# 3. 使用真实 LLM API（需配置 API Key）
export LLM_API_KEY="your-api-key"
npm run llm:generate -- tmp/analyze/out/summary.json

# 4. 使用生成的规则再次分析
node out/cli/analyze.js --repo ./tests --llm rules/llm_candidate.rules.json
```

## 1. 整体架构

```
[探针] 扫描 API → 产出 IR (invoke 签名、调用点等)
       ↓
[汇总] 分析结果 → summary.json (卡点、未覆盖调用)
       ↓
[LLM] 提示词 + IR → 大模型 → 规则 JSON
       ↓
[应用] llm_candidate.rules.json → analyze --llm 使用
```

## 2. 现有数据源

### 2.1 探针：`dump_invoke_signatures`

```bash
node out/cli/dump_invoke_signatures.js --repo <path> --sourceDir . --output tmp/signatures.json
```

**产出** `signatures.json` 结构：

```json
{
  "signatures": [{
    "signature": "@ets/xxx.ets: ClassName.methodName(argType)",
    "methodName": "methodName",
    "classSignature": "...",
    "className": "ClassName",
    "invokeKind": "instance|static|ptr",
    "argCount": 2,
    "count": 5,
    "samples": [{
      "callerSignature": "...",
      "callerMethod": "aboutToAppear",
      "callerFile": "entry/src/main/ets/pages/X.ets",
      "line": 42,
      "invokeText": "this.viewModel.getData(this.id)"
    }]
  }]
}
```

适合：Source/Sink 规则（有 snippet 和调用上下文）。

### 2.2 分析结果：`analyze` → `summary.json`

```bash
node out/cli/analyze.js --repo <path> --outputDir tmp/analyze/out
```

**关键字段**（对应 LLM 输入协议里的 `hotspots`）：

| 字段 | 用途 | 对应规则类型 |
|------|------|--------------|
| `ruleFeedback.uncoveredHighFrequencyInvokes` | 高频但未被 source/sink/transfer 覆盖的调用 | Source / Sink |
| `ruleFeedback.noCandidateCallsites` | 有污点流过但**没有候选 transfer 规则**的调用点 | **Transfer** |

**noCandidateCallsites** 示例：

```json
{
  "callee_signature": "@ets/viewmodel/X.ets: X.getData(string)",
  "method": "getData",
  "invokeKind": "instance",
  "argCount": 1,
  "sourceFile": "entry/src/main/ets/viewmodel/X.ets",
  "count": 3,
  "topEntries": ["EntryAbility@entry/src/main/ets/entryability/EntryAbility.ets"]
}
```

注意：当前**没有** `dataflowHint`（from/to），需用启发式或下文增强方案补全。

## 3. Transfer 规则生成缺口与方案

### 3.1 缺口

协议要求 Transfer 的 hotspot 带 `dataflowHint`：

```json
{
  "dataflowHint": { "from": "arg0", "to": "result" }
}
```

`noCandidateCallsites` 目前只有 `callee_signature`、`method`、`argCount` 等，**没有** from/to。

### 3.2 方案 A：启发式补全（不改引擎，先实现）

根据常见模式推断 from/to：

| 场景 | 启发式 |
|------|--------|
| `argCount >= 1` | `from: "arg0"`, `to: "result"` |
| `invokeKind === "instance"` 且 `argCount === 0` | `from: "base"`, `to: "result"` |
| 方法名含 `set`/`put`/`push` | `from: "arg0"`, `to: "base"` |

在构建 LLM 输入时，根据 `invokeKind`、`argCount`、`methodName` 填 `dataflowHint`。

### 3.3 方案 B：引擎增强（推荐后续做）

在 `ConfigBasedTransferExecutor` 记录 noCandidate 时，把当前 tainted fact 的 endpoint 记下来，作为 `fromHint`：

- 修改 `TransferNoCandidateCallsite`（`TransferTypes.ts`）增加可选字段：
  - `fromHint?: RuleEndpoint`
- 在 `ConfigBasedTransferExecutor.ts` 第 275–290 行，当 `candidateRules.length === 0` 时，从 `taintedFact` 解析 endpoint 写入 `fromHint`

`to` 仍可用启发式：有 `result` 则 `to: "result"`，否则 `to: "arg0"` 等。

## 4. 实现步骤

### Step 1：构建 LLM 输入（hotspots）

从 `summary.json` + 可选 `signatures.json` 构建协议中的 `hotspots`：

```typescript
// 伪代码
function buildHotspotsFromSummary(summaryPath: string): Hotspot[] {
  const report = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const hotspots: Hotspot[] = [];
  const rf = report.summary?.ruleFeedback;

  // Transfer: noCandidateCallsites
  for (const item of rf?.noCandidateCallsites || []) {
    const dataflowHint = inferDataflowHint(item);  // 方案 A 启发式
    hotspots.push({
      id: `hs_t_${hotspots.length + 1}`,
      reason: 'no_candidate_rule_for_callsite',
      functionSignature: item.callee_signature,
      file: item.sourceFile,
      method: item.method,
      snippet: lookupSnippet(item, signatures),  // 从 signatures.json 的 samples 找
      dataflowHint,
    });
  }

  // Source/Sink: uncoveredHighFrequencyInvokes
  for (const item of rf?.uncoveredHighFrequencyInvokes || []) {
    hotspots.push({
      id: `hs_u_${hotspots.length + 1}`,
      reason: 'unknown_external_function',  // 或根据场景选 no_sink_match 等
      functionSignature: item.signature,
      method: item.methodName,
      // ...
    });
  }

  return hotspots;
}

function inferDataflowHint(item: NoCandidateCallsite): { from: string; to: string } {
  const { invokeKind, argCount, method } = item;
  const nameLower = (method || '').toLowerCase();
  if (nameLower.includes('set') || nameLower.includes('put') || nameLower.includes('push')) {
    return { from: 'arg0', to: 'base' };
  }
  if (argCount >= 1) return { from: 'arg0', to: 'result' };
  if (invokeKind === 'instance') return { from: 'base', to: 'result' };
  return { from: 'arg0', to: 'result' };  // 默认
}
```

### Step 2：LLM 调用脚本

```typescript
// tools/llm_rule_generator.ts（新建）

import * as fs from 'fs';
import * as path from 'path';

const CONTRACT = JSON.parse(
  fs.readFileSync('docs/llm_fewshot_wanharmony.json', 'utf-8')
);

async function callLLM(prompt: string): Promise<string> {
  // 方式 1: OpenAI
  // const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4o-mini',
  //     messages: [{ role: 'user', content: prompt }],
  //     temperature: 0.3,
  //   }),
  // });
  // const data = await resp.json();
  // return data.choices[0].message.content;

  // 方式 2: 国内 API（如 DeepSeek、通义等）类似，改 URL 和 body 格式
  throw new Error('请接入实际 LLM API');
}

function buildPrompt(hotspots: any[]): string {
  const request = {
    contractVersion: '1.0',
    project: { name: 'project', repoPath: '.', sourceDirs: ['.'], ruleLayers: ['default', 'framework'] },
    constraints: { topN: 25, allowedKinds: ['source', 'sink', 'transfer', 'sanitizer'], maxRulesPerHotspot: 2 },
    hotspots,
  };
  const fewShot = JSON.stringify(CONTRACT.examples.slice(0, 3), null, 2);
  return `你是一个污点分析规则生成助手。根据以下协议和 few-shot 样本，对 hotspots 生成规则。

## Few-shot 样本
${fewShot}

## 当前请求
${JSON.stringify(request, null, 2)}

请严格按照输出协议返回 JSON，只包含 decisions 数组。`;
}

async function main() {
  const summaryPath = process.argv[2] || 'tmp/analyze/out/summary.json';
  const outputPath = process.argv[3] || 'rules/llm_candidate.rules.json';

  const hotspots = buildHotspotsFromSummary(summaryPath);
  if (hotspots.length === 0) {
    console.log('No hotspots, skipping.');
    return;
  }

  const prompt = buildPrompt(hotspots);
  const rawResponse = await callLLM(prompt);
  const parsed = parseLLMResponse(rawResponse);  // 提取 JSON，容错
  const ruleSet = convertDecisionsToRuleSet(parsed.decisions);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(ruleSet, null, 2), 'utf-8');
  console.log(`Wrote ${outputPath}`);
}
```

### Step 3：将 decisions 转为 `llm_candidate.rules.json`

按协议，`decisions` 中 `action === 'emit_rule'` 的项才生成规则，合并进一个 `TaintRuleSet`：

```typescript
function convertDecisionsToRuleSet(decisions: any[]): TaintRuleSet {
  const sources: SourceRule[] = [];
  const sinks: SinkRule[] = [];
  const transfers: TransferRule[] = [];

  for (const d of decisions) {
    if (d.action !== 'emit_rule' || !d.rule) continue;
    const rule = { ...d.rule, enabled: false };
    if (d.ruleKind === 'source') sources.push(rule);
    else if (d.ruleKind === 'sink') sinks.push(rule);
    else if (d.ruleKind === 'transfer') transfers.push(rule);
    // sanitizer 同理
  }

  return {
    schemaVersion: '1.1',
    meta: { description: 'LLM generated candidates' },
    sources,
    sinks,
    transfers,
  };
}
```

### Step 4：串联流程

```bash
# 1. 探针（可选，用于 snippet）
npm run test:sdk-signature-probe -- --repo ./tests --output tmp/signatures.json

# 2. 污点分析
node out/cli/analyze.js --repo ./tests --outputDir tmp/analyze/out --profile fast

# 3. LLM 生成规则（需实现并配置 API Key）
npx ts-node tools/llm_rule_generator.ts tmp/analyze/out/summary.json rules/llm_candidate.rules.json

# 4. 使用生成的规则再次分析
node out/cli/analyze.js --repo ./tests --llm rules/llm_candidate.rules.json --outputDir tmp/analyze/with_llm
```

## 5. Transfer 提示词要点

在 `buildPrompt` 或 system prompt 中可强调：

- `no_candidate_rule_for_callsite` 的 hotspot 应**优先生成 transfer**。
- Transfer 必须包含：`match`（如 `signature_contains`）、`from`、`to`。
- 常见 `from`/`to`：`arg0`→`result`、`base`→`result`、`arg0`→`base` 等。
- 使用 `scope.className` 收窄匹配范围，减少误伤。

## 6. 完整实现: `tools/llm_rule_generator.ts`

完整脚本已实现，位于 `tools/llm_rule_generator.ts`，支持：

### 6.1 CLI 使用

```bash
# 基本用法
npx ts-node tools/llm_rule_generator.ts <summary.json> [output.rules.json]

# 选项
--mock       使用模拟 LLM（测试用，无需 API）
--dry-run    只构建 hotspots，不调用 LLM
--verbose    显示详细输出
-o, --output 指定输出路径

# npm scripts
npm run llm:generate -- <summary.json>          # 真实 API
npm run llm:generate:mock -- <summary.json>     # Mock 模式
```

### 6.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API Key（必需） | - |
| `LLM_API_URL` | API 端点 | OpenAI |
| `LLM_MODEL` | 模型名称 | gpt-4o-mini |

### 6.3 使用国内大模型

修改环境变量即可：

```bash
# DeepSeek
export LLM_API_URL="https://api.deepseek.com/v1/chat/completions"
export LLM_API_KEY="sk-xxx"
export LLM_MODEL="deepseek-chat"

# 通义千问
export LLM_API_URL="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
export LLM_API_KEY="sk-xxx"
export LLM_MODEL="qwen-turbo"
```

### 6.4 输出文件

| 文件 | 说明 |
|------|------|
| `llm_candidate.rules.json` | 生成的规则集（默认 enabled: false） |
| `llm_candidate.rules.report.json` | 生成报告（包含所有 decisions） |

## 7. 实现状态

| 模块 | 状态 |
|------|------|
| 探针 IR | ✅ dump_invoke_signatures |
| 分析卡点 | ✅ summary.json ruleFeedback |
| Source/Sink 输入构建 | ✅ uncoveredHighFrequencyInvokes |
| Transfer 输入构建 | ✅ 启发式 dataflowHint |
| LLM 调用 | ✅ OpenAI 兼容 API |
| 规则写入 | ✅ llm_candidate.rules.json |
| Mock 模式 | ✅ 用于测试 |
