# ArkTaint Rule Asset 编写说明

本文档说明当前 ArkTaint 的 rule 类安全资产格式。Rule 资产只表达局部安全语义，例如某个 API 的返回值是 source、某个参数是 sink、某个调用把污点从一个 endpoint 传到另一个 endpoint，或某个 endpoint 经过明确 sanitizer 清洗。

当前 rule 资产已经统一到 Asset Model v2 的声明式结构。不要再编写旧版 rule-set 分组格式，也不要在 rule 文件里放版本分支字段。所有 rule 文件都必须使用：

```text
surfaces -> bindings -> effectTemplates
```

其中：

- `surfaces` 描述资产覆盖哪个程序面，也就是 API 身份。
- `bindings` 描述该程序面承担哪个安全角色，以及作用在哪个 endpoint。
- `effectTemplates` 描述运行时匹配到该程序面后产生什么标准 rule effect。

## 1. Rule、Module、ArkMain 的边界

优先使用 rule 的场景：

- 把 API 返回值、回调参数或对象字段标为 source。
- 把 API 参数、receiver 或字段标为 sink。
- 表达局部 transfer，例如 `arg0 -> return`、`arg0.field -> callbackArg1`。
- 表达语义确定的 sanitizer。

不要用 rule 处理这些问题：

- AppStorage、router、event、state slot 这类 publish/consume/kill/link 交接语义；这些属于 module/handoff effect，由语义交接敏感传播消费。
- 生命周期入口、页面入口、系统回调注册；这些属于 ArkMain/entry effect。
- 项目私有复杂 wrapper、业务 SDK 协议、黑盒三方库；这些优先进入 LLM 项目建模流程，人工审计通过后形成项目资产。

Rule 的核心原则是：只声明局部 effect，不直接补 PAG 边，不直接发 taint fact，不自行做路径过滤。

## 2. 目录约定

内置 rule 资产位于：

```text
src/models/kernel/rules/
  sources/
  sinks/
  sanitizers/
  transfers/
```

测试和临时项目 rule 资产通常位于：

```text
tests/rules/
```

文件名仍使用 `*.rules.json`，但文件内容是统一资产文档，而不是旧版 sources/sinks 分组结构。

CLI 仍可通过现有参数加载 rule 资产：

```bash
node out/cli/analyze.js --repo <repo> --model-root src/models
node out/cli/analyze.js --repo <repo> --project tests/rules/example.rules.json
node out/cli/analyze.js --repo <repo> --candidate tmp/project_modeling_candidates/<run>/<project>/asset.rules.json
```

## 3. 顶层结构

Rule asset 顶层结构如下：

```json
{
  "id": "asset.rule.project.example",
  "plane": "rule",
  "status": "reviewed",
  "surfaces": [],
  "bindings": [],
  "effectTemplates": [],
  "relations": [],
  "provenance": {
    "source": "project",
    "projectId": "example",
    "evidenceLocations": [
      {
        "file": "entry/src/main/ets/pages/Index.ets",
        "line": 12
      }
    ]
  }
}
```

必要字段：

| 字段 | 含义 |
|---|---|
| `id` | 资产唯一标识。建议包含 `asset.rule.<scope>.<name>`。 |
| `plane` | 必须是 `rule`。 |
| `status` | 资产状态。正式内置资产通常是 `official`；人工审计后的项目资产通常是 `reviewed` 或 `replayed`。 |
| `surfaces` | 资产覆盖的程序面。正式资产不得为空。 |
| `bindings` | surface 到安全角色和 effect template 的绑定。正式资产不得为空。 |
| `effectTemplates` | 声明式 rule effect 模板。 |
| `provenance` | 资产来源和证据位置。 |

## 4. Surface

Surface 只说明 API 是谁，不说明它的安全语义。最常见的是 `invoke` surface。

```json
{
  "surfaceId": "surface.project.logger.info",
  "kind": "invoke",
  "modulePath": "@project/logger",
  "ownerName": "Logger",
  "methodName": "info",
  "invokeKind": "static",
  "argCount": 1,
  "confidence": "certain",
  "provenance": {
    "source": "manual"
  }
}
```

`invokeKind` 常用值：

| 值 | 使用场景 | 必要身份字段 |
|---|---|---|
| `instance` | `obj.method(...)` | `modulePath + ownerName + methodName + argCount` |
| `static` | `Class.method(...)` | `modulePath + ownerName + methodName + argCount` |
| `namespace` | `ns.method(...)` | `modulePath + ownerName/functionName + argCount` |
| `free-function` | `fn(...)` | `modulePath + functionName + argCount` |

注意：

- Surface 身份必须来自 analyzer/import/type/source-location 证据或人工确认的稳定结构。
- 不要用方法名包含、owner 名猜测、自然语言描述来替代 surface 身份。
- LLM 可以提出 surface 候选，但正式资产必须能被结构化证据支撑。

## 5. Endpoint

Endpoint 描述安全语义作用于哪个值位置。常见写法：

```json
{ "base": { "kind": "arg", "index": 0 } }
```

带字段路径：

```json
{
  "base": { "kind": "arg", "index": 0 },
  "accessPath": ["headers", "Authorization"]
}
```

常用 endpoint base：

| base.kind | 含义 |
|---|---|
| `receiver` | 调用 receiver，例如 `obj`。 |
| `arg` | 普通实参。 |
| `return` | 调用返回值。 |
| `callbackArg` | 回调参数。 |
| `callbackReturn` | 回调返回值。 |
| `promiseResult` | Promise/await 结果。 |
| `constructorResult` | 构造结果。 |

## 6. Binding

Binding 把 surface 绑定到安全角色、endpoint 和 effect template。

```json
{
  "bindingId": "binding.project.logger.info.arg0",
  "surfaceId": "surface.project.logger.info",
  "assetId": "asset.rule.project.logger",
  "plane": "rule",
  "role": "sink",
  "endpoint": {
    "base": { "kind": "arg", "index": 0 }
  },
  "selector": {
    "kind": "signature-contains",
    "value": "Logger.info"
  },
  "effectTemplateRefs": [
    "template.project.logger.info.arg0"
  ],
  "semanticsFamily": "privacy-log",
  "completeness": "complete",
  "confidence": "certain"
}
```

常用 `role`：

| role | 说明 |
|---|---|
| `source` | 产生敏感数据。 |
| `sink` | 消费敏感数据，可能形成泄露、存储、网络发送等风险流。 |
| `sanitizer` | 对指定 endpoint 进行明确清洗。 |
| `transfer` | 局部传播污点。 |

`selector` 是运行时命中规则用的匹配条件。`surface` 是资产身份，`selector` 是具体匹配策略；两者不能混为一谈。

## 7. Effect Template

Effect template 声明匹配到 binding 后产生什么 rule effect。它不是运行时 fact，也不是路径证据。

### 7.1 Source

```json
{
  "id": "template.project.account.getToken.return",
  "kind": "rule.source",
  "confidence": "certain",
  "value": {
    "base": { "kind": "return" }
  },
  "sourceKind": "credential"
}
```

### 7.2 Sink

```json
{
  "id": "template.project.logger.info.arg0",
  "kind": "rule.sink",
  "confidence": "certain",
  "value": {
    "base": { "kind": "arg", "index": 0 }
  },
  "sinkKind": "information_leak"
}
```

### 7.3 Transfer

```json
{
  "id": "template.project.codec.encode.arg0.to.return",
  "kind": "rule.transfer",
  "confidence": "certain",
  "from": {
    "base": { "kind": "arg", "index": 0 }
  },
  "to": {
    "base": { "kind": "return" }
  }
}
```

### 7.4 Sanitizer

```json
{
  "id": "template.project.mask.phone.return",
  "kind": "rule.sanitizer",
  "confidence": "certain",
  "value": {
    "base": { "kind": "return" }
  },
  "sanitizerKind": "masking"
}
```

Sanitizer 必须谨慎。普通字符串转换、截取、序列化、类型转换不能直接当作 sanitizer。只有语义明确的脱敏、加密、哈希或经过人工确认的清洗函数才应写入 sanitizer rule。

## 8. 完整示例：日志 sink

```json
{
  "id": "asset.rule.project.logger",
  "plane": "rule",
  "status": "reviewed",
  "surfaces": [
    {
      "surfaceId": "surface.project.logger.info",
      "kind": "invoke",
      "modulePath": "@project/logger",
      "ownerName": "Logger",
      "methodName": "info",
      "invokeKind": "static",
      "argCount": 1,
      "confidence": "certain",
      "provenance": {
        "source": "manual"
      }
    }
  ],
  "bindings": [
    {
      "bindingId": "binding.project.logger.info.arg0",
      "surfaceId": "surface.project.logger.info",
      "assetId": "asset.rule.project.logger",
      "plane": "rule",
      "role": "sink",
      "endpoint": {
        "base": { "kind": "arg", "index": 0 }
      },
      "selector": {
        "kind": "signature-contains",
        "value": "Logger.info"
      },
      "effectTemplateRefs": [
        "template.project.logger.info.arg0"
      ],
      "semanticsFamily": "privacy-log",
      "completeness": "complete",
      "confidence": "certain"
    }
  ],
  "effectTemplates": [
    {
      "id": "template.project.logger.info.arg0",
      "kind": "rule.sink",
      "confidence": "certain",
      "value": {
        "base": { "kind": "arg", "index": 0 }
      },
      "sinkKind": "information_leak"
    }
  ],
  "provenance": {
    "source": "project",
    "projectId": "example",
    "evidenceLocations": [
      {
        "file": "entry/src/main/ets/common/Logger.ets",
        "line": 8
      }
    ]
  }
}
```

## 9. 质量要求

新增或修改 rule asset 时必须满足：

1. 每个正式资产必须有稳定 `surface`、明确 `binding` 和可消费的 `effectTemplate`。
2. 一个 binding 可以引用多个 effect template，但必须能解释每个 effect 的必要性。
3. 同一个 API 的不同 role、endpoint、guard 必须分开表达，不能用“API 已覆盖”替代细粒度覆盖。
4. 项目私有 API 不得写入通用 kernel 资产；应先进入项目建模包或 LLM 候选资产。
5. 官方/原生 API 语义可以进入 `src/models/kernel`，但必须有稳定证据和正负例。
6. 不要通过扩大 selector 来追求召回；selector 过宽会污染 known-covered 与 source-sink 结果。
7. 不要把 taint flow 直接当漏洞。Rule asset 只负责静态污点语义，漏洞判断属于审计和报告层。

## 10. 验证

修改 rule asset 后至少运行：

```bash
npm run build
npm run test:rule-assets-v2-schema
npm run test:rule-asset-lowering
```

如果改动影响 source/sink/transfer/sanitizer 行为，还应运行对应精确性测试：

```bash
npm run test:source-exact
npm run test:sink-exact
npm run test:transfer-exact
npm run test:analyze-kernel-sanitizer-catalog
```

提交前建议运行：

```bash
npm run verify
```

## 11. 相关文件

- 公共 schema：`src/core/assets/schema/`
- Rule lowering：`src/core/rules/RuleAssetLowering.ts`
- Rule loader：`src/core/rules/RuleLoader.ts`
- 内置 rule 资产：`src/models/kernel/rules/`
- Rule schema 测试：`src/tests/rules/test_rule_assets_v2_schema.ts`
- Rule lowering 测试：`src/tests/rules/test_rule_asset_lowering.ts`
